import test from 'node:test';
import assert from 'node:assert/strict';
const gatewayUrl=new URL('../hosted/api/gateway.js',import.meta.url);
const {default:handler}=await import(gatewayUrl.href);
async function call(path:string,body:unknown={},cookie='',origin='https://demo.example') {
 const headers:Record<string,string>={};let payload='';
 const res={statusCode:0,setHeader:(k:string,v:string)=>{headers[k.toLowerCase()]=v;},end:(v:string)=>{payload=v;}};
 await handler({url:path,method:'POST',headers:{host:'demo.example',origin,'content-type':'application/json',cookie},body},res);
 return {status:res.statusCode,headers,body:JSON.parse(payload)};
}
test('hosted work requires a valid private demo session and fails closed without a key',async()=>{
 const previous=process.env.DEMO_ACCESS_CODE;
 try {
  process.env.DEMO_ACCESS_CODE='test-only-random-demo-code-not-a-live-secret';
  for(const path of ['/api/feedback','/api/workflow/start','/api/workflow/reset']) {
   assert.equal((await call(path)).status,401);
   assert.equal((await call(path,{},'demo_session=forged')).status,401);
  }
  assert.equal((await call('/api/session',{code:'incorrect'})).status,401);
  const auth=await call('/api/session',{code:process.env.DEMO_ACCESS_CODE});assert.equal(auth.status,200);
  const cookie=auth.headers['set-cookie']!;assert.match(cookie,/HttpOnly/);assert.match(cookie,/Secure/);assert.match(cookie,/SameSite=Strict/);assert.ok(!cookie.includes(process.env.DEMO_ACCESS_CODE));
  // Authorized invalid payloads reach validation, without queuing any real work.
  for(const path of ['/api/feedback','/api/workflow/start','/api/workflow/reset'])assert.equal((await call(path,{},cookie)).status,400);
  assert.equal((await call('/api/feedback',{},cookie,'https://other.example')).status,403);
  process.env.DEMO_ACCESS_CODE='rotated-test-code';assert.equal((await call('/api/feedback',{},cookie)).status,401);
  delete process.env.DEMO_ACCESS_CODE;
  assert.equal((await call('/api/feedback',{},cookie)).status,401);
  assert.equal((await call('/api/session',{code:''})).status,401);
 }finally{if(previous===undefined)delete process.env.DEMO_ACCESS_CODE;else process.env.DEMO_ACCESS_CODE=previous;}
});
