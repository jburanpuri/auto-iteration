const $ = selector => document.querySelector(selector);
const categories = { general: 'General', ui_ux: 'UI/UX issue', performance: 'Performance' };
const channels = { general: '#core-engineering-team', ui_ux: '#ui-ux-team', performance: '#performance-team' };
let pendingBatch;
let pendingReset;
let resetQueued=false;
let previousReset;
let busy = false;
let sampleReviews = [];
let state;
function node(tag, text, className) { const item=document.createElement(tag); if(text!==undefined)item.textContent=text; if(className)item.className=className;return item; }
function link(text, url) { const item=node('a',text);item.href=url;item.target='_blank';item.rel='noopener';return item; }
async function api(path, body) {
 const options=body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)};
 let r=await fetch(path,options);
 if(r.status===401&&['127.0.0.1','localhost'].includes(location.hostname)){await fetch('/');r=await fetch(path,options);}
 const data=await r.json();if(!r.ok)throw new Error(data.error||'Could not load feedback.');return data;
}
let allReviews = [];
let visibleCount = 20;
function renderReviews() {
 const list=$('#reviews');list.replaceChildren();
 for(const review of allReviews.slice(0,visibleCount)) {
  const card=node('article',undefined,'review');const author=node('div',undefined,'author');
  const person=node('div',review.name,'person');person.append(node('small',`${review.sample?'Sample · ':''}${new Date(review.postedAt).toDateString() === new Date().toDateString() ? 'Today' : new Date(review.postedAt).toLocaleDateString()} · ${new Date(review.postedAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`));
  author.append(node('span',review.name[0],'avatar'),person);
  const body=node('div');body.append(node('span',categories[review.category],`category ${review.category}`),node('p',review.text));
  card.append(author,body);list.append(card);
 }
 $('#count').textContent=String(allReviews.length);
 $('#more').hidden=visibleCount>=allReviews.length;
 $('#more').textContent=`Show 20 more reviews (${Math.min(visibleCount,allReviews.length)} of ${allReviews.length})`;
}
function showReviews(scenarios) {
 if(!sampleReviews.length)sampleReviews=scenarios.flatMap(scenario=>scenario.reviews.map(review=>({...review,sample:true,category:scenario.category})));
 allReviews=sampleReviews.concat((state.reviews || []).filter(r=>!r.sample).map(r=>({name:r.feedback.text.match(/^Reported by (.*?) \(/)?.[1] || 'A user',text:r.feedback.text.replace(/^Reported by [^\n]*\n/,''),category:r.feedback.category || 'general',postedAt:r.at}))).sort((a,b)=>b.postedAt.localeCompare(a.postedAt));
 renderReviews();
}
$('#more').onclick=()=>{visibleCount+=20;renderReviews();};
function showIssues(tasks) {
 const related=tasks.filter(task=>task.batchId||['vercel-feedback','demo-http'].includes(task.feedback.source));
 const latest=related.reduce((found,task)=>!found||task.createdAt>found.createdAt?task:found,undefined);
 const batch=latest ? related.filter(task=>latest.batchId ? task.batchId===latest.batchId : task.taskId===latest.taskId) : [];
 $('#summary').hidden=!batch.length;$('#issues').replaceChildren();
 const sent=batch.filter(task=>task.discord).length;
 $('#summary-status').textContent=sent===batch.length ? `${sent} issues sent to the engineering teams.` : `${sent} of ${batch.length} issues sent to Discord. Investigations are running.`;
 for(const task of batch) {
  if(task.discord)$('#issues').append(link(`${channels[task.feedback.category]} ↗`,`https://discord.com/channels/${task.discord.guildId}/${task.discord.channelId}/${task.discord.messageId}`));
  if(task.publication?.status==='published')$('#issues').append(link('Open live fix ↗',task.publication.url));
 }
 return !!batch.length;
}
async function refresh() {
 try {
  state=await api('/api/tasks');
  if(state.reset?.status==='complete'&&previousReset!==state.reset.id){sampleReviews=[];visibleCount=20;previousReset=state.reset.id;}
  showReviews(state.demoScenarios || []);
  const started=showIssues(state.tasks);
  const batch=state.batches?.[0];
  if(batch&&['pending','summarizing'].includes(batch.status))$('#notice').textContent='Summarizing all unprocessed reviews. Proposals will appear here and in Discord.';
  else if(batch?.status==='ready')$('#notice').textContent=batch.reportIds.length ? `${batch.reportIds.length} reports grouped into ${batch.taskIds.length} issues. Follow the proposals in Discord.` : 'No unprocessed feedback. New submissions will be included in the next run.';
  else if(batch?.status==='failed')$('#notice').textContent=`Summary needs attention: ${batch.error || 'Please retry.'}`;
  if(state.hosted&&!state.workerOnline)$('#notice').textContent='The engineering worker is offline. Feedback and workflow requests are saved until it reconnects.';
  if(pendingReset&&state.reset?.id===pendingReset&&state.reset.status!=='running'){pendingReset=undefined;resetQueued=false;}
  const resetting=resetQueued||state.reset?.status==='running';
  if(state.reset && (resetting||state.reset.status==='failed'))$('#notice').textContent=state.reset.message;
  else if(state.reset?.status==='complete'&&!state.batches?.length&&!state.tasks?.length)$('#notice').textContent=state.reset.message;
  $('#start').disabled=busy||resetting;
  $('#reset').disabled=busy||resetting;
  $('#start').replaceChildren(node('span',busy?'Starting…':started?'Summarize new feedback':'Summarize & start workflow'),node('span','↗'));
  if(!busy&&!$('#notice').textContent)$('#notice').textContent=state.mode==='scripted-demo'?'Scripted rehearsal. Switch to live Codex to investigate all three issues.':!state.discord?'Discord is disconnected. Summaries will appear here; team delivery requires the bot connection.':'';
 }catch(error){$('#notice').textContent=error.message;$('#notice').classList.add('error');}
}
$('#start').onclick=async()=>{
 if(busy)return;busy=true;pendingBatch??=crypto.randomUUID();$('#start').disabled=true;
 $('#notice').classList.remove('error');$('#notice').textContent='Starting a summary of all unprocessed feedback…';
 try {
  if(state.hosted&&!state.canStart) { const code=window.prompt('Enter your demo access code to start the workflow.');if(!code)throw new Error('Workflow not started.');await api('/api/session',{code}); }
  await api('/api/workflow/start',{batchId:pendingBatch});pendingBatch=undefined;$('#notice').textContent='Workflow queued. Codex will summarize the feedback and investigate each issue.';
 }
 catch(error){$('#notice').textContent=error.message;$('#notice').classList.add('error');}
 finally{busy=false;await refresh();}
};
$('#reset').onclick=async()=>{
 if(busy)return;
 if(!window.confirm('Reset this demo? This restores the product bugs, archives the current run, and removes this bot’s messages from the three demo engineering channels.'))return;
 busy=true;$('#reset').disabled=true;$('#start').disabled=true;pendingReset??=crypto.randomUUID();
 try {
  if(state.hosted&&!state.canStart){const code=window.prompt('Enter your demo access code.');if(!code)throw new Error('Reset cancelled.');await api('/api/session',{code});}
  await api('/api/workflow/reset',{resetId:pendingReset});resetQueued=true;$('#notice').textContent='Reset queued. Restoring the demo and clearing its bot messages…';
 }catch(error){$('#notice').textContent=error.message;}
 finally{busy=false;await refresh();}
};
void refresh();setInterval(()=>{if(!document.hidden&&!busy)void refresh();},10000);
