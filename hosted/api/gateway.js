import { get, put, list, BlobNotFoundError } from '@vercel/blob';
import { createHash, timingSafeEqual } from 'node:crypto';
import { scenarios } from './samples.js';
const hash = value => createHash('sha256').update(value).digest('hex');
const authorized = req => {
  const expected = hash(process.env.DEMO_ACCESS_CODE || 'disabled');
  const cookie = req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith('demo_session='))?.slice(13) || '';
  return Boolean(process.env.DEMO_ACCESS_CODE) && cookie.length === expected.length && timingSafeEqual(Buffer.from(cookie),Buffer.from(expected));
};
async function read(path) {
  try { const result = await get(path,{access:'private',useCache:false}); return result?.statusCode === 200 ? JSON.parse(await new Response(result.stream).text()) : null; }
  catch(error) { if(error instanceof BlobNotFoundError)return null; throw error; }
}
async function create(path, data) {
  try { await put(path,JSON.stringify(data),{access:'private',addRandomSuffix:false,allowOverwrite:false,contentType:'application/json'}); }
  catch(error) { const existing=await read(path); if(!existing)throw error; if(JSON.stringify(existing)!==JSON.stringify(data))throw Object.assign(new Error('This submission ID was already used.'),{status:409}); }
}
export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store'); res.setHeader('Content-Type','application/json');
  const send=(status,data)=>{res.statusCode=status;res.end(JSON.stringify(data));};
  try {
    const path=new URL(req.url,'https://demo.invalid').pathname;
    if(req.method==='GET'&&path==='/health')return send(200,{status:'ok',service:'Northstar feedback'});
    const artifact=/^\/api\/releases\/([a-f0-9-]{36})\/(record|patch|tests)$/.exec(path);
    if(req.method==='GET'&&artifact) {
      if(!authorized(req))return send(401,{error:'Demo access required.'});
      const data=await read(`releases/${artifact[1]}/${artifact[2]}.json`);
      return data ? send(200,data) : send(404,{error:'Release artifact not found.'});
    }
    if(req.method==='GET'&&path==='/api/tasks') {
      const state=await read('state/snapshot.json') || {tasks:[],reviews:[],batches:[],discord:false,mode:'codex',hosted:true,productUrl:'/product'};
      const now=new Date();const start=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime();
      const demoScenarios=scenarios.map((s,g)=>({...s,reviews:s.reviews.map((r,i)=>({...r,postedAt:new Date(now.getTime()-(now.getTime()-start)*(i*3+g)/120).toISOString()}))}));
      return send(200,{...state,reset:await read('state/reset.json'),demoScenarios,canStart:authorized(req),workerOnline:!!state.workerAt && Date.now()-Date.parse(state.workerAt)<90000});
    }
    if(req.method!=='POST')return send(404,{error:'Route not found.'});
    if(req.headers.origin!==`https://${req.headers.host}`)return send(403,{error:'Same-origin request required.'});
    if(!/^application\/json/.test(req.headers['content-type']||''))return send(415,{error:'Send JSON.'});
    let body=req.body;
    if(typeof body==='string') { if(body.length>16000)return send(413,{error:'Feedback is too long.'});body=JSON.parse(body); }
    if(!body||JSON.stringify(body).length>16000)return send(400,{error:'Invalid request.'});
    if(path==='/api/session') {
      if(typeof body.code!=='string'||!process.env.DEMO_ACCESS_CODE||hash(body.code)!==hash(process.env.DEMO_ACCESS_CODE))return send(401,{error:'Enter the demo access code to unlock feedback and workflow controls.'});
      res.setHeader('Set-Cookie',`demo_session=${hash(body.code)}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`);
      return send(200,{ok:true});
    }
    if(path==='/api/feedback') {
      if(!authorized(req))return send(401,{error:'Enter the demo access code to submit feedback.'});
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.externalId)||typeof body.reviewer!=='string'||!body.reviewer.trim()||body.reviewer.length>80||typeof body.text!=='string'||!body.text.trim()||body.text.length>11000||!['general','ui_ux','performance'].includes(body.category))return send(400,{error:'Enter your name, category, and feedback.'});
      const feedback={externalId:body.externalId,source:'vercel-feedback',category:body.category,title:`${body.reviewer.trim()}: ${body.text.trim().slice(0,100)}`,text:`Reported by ${body.reviewer.trim()} (self-reported name).\n${body.text.trim()}`};
      await create(`inbox/feedback/${body.externalId}.json`,feedback);
      return send(202,{status:'queued',message:'Feedback saved. Code investigation is queued.'});
    }
    if(path==='/api/workflow/reset') {
      if(!authorized(req))return send(401,{error:'Enter the demo access code to reset.'});
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.resetId))return send(400,{error:'Invalid reset ID.'});
      await create(`inbox/reset/${body.resetId}.json`,{resetId:body.resetId});return send(202,{status:'pending',id:body.resetId});
    }
    if(path==='/api/workflow/start') {
      if(!authorized(req))return send(401,{error:'Enter the demo access code to unlock feedback and workflow controls.'});
      if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.batchId))return send(400,{error:'Invalid batch ID.'});
      await create(`inbox/start/${body.batchId}.json`,{batchId:body.batchId});
      return send(202,{status:'pending',id:body.batchId});
    }
    if(path==='/api/events')return send(202,{accepted:false,message:'Client diagnostics are not persisted on the hosted demo.'});
    return send(404,{error:'Route not found.'});
  }catch(error){console.error(error.name,error.message);return send(error.status||503,{error:error.status?error.message:'The feedback inbox is temporarily unavailable. Please retry.'});}
}
