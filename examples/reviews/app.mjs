const $ = selector => document.querySelector(selector);
const categories = { general: 'General', ui_ux: 'UI/UX issue', performance: 'Performance' };
const channels = { general: '#core-engineering-team', ui_ux: '#ui-ux-team', performance: '#performance-team' };
let pendingBatch;
let busy = false;
let sampleReviews = [];
let state;
function node(tag, text, className) { const item=document.createElement(tag); if(text!==undefined)item.textContent=text; if(className)item.className=className;return item; }
function link(text, url) { const item=node('a',text);item.href=url;item.target='_blank';item.rel='noopener';return item; }
async function api(path, body) {
 const r=await fetch(path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
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
 const samples=tasks.filter(task=>task.batchId || task.feedback.source.startsWith('demo-batch:'));
 const latest=samples.reduce((found,task)=>!found||task.createdAt>found.createdAt?task:found,undefined);
 if(!latest) { $('#summary').hidden=true; return false; }
 const batch=samples.filter(task=>task.feedback.source===latest.feedback.source);
 const order=['general','ui_ux','performance'];batch.sort((a,b)=>order.indexOf(a.feedback.category)-order.indexOf(b.feedback.category));
 $('#summary').hidden=false;$('#issues').replaceChildren();
 const ready=batch.filter(task=>task.plan||task.status==='failed').length;
 $('#summary-status').textContent=`${ready} of ${batch.length} issues summarized`;
 for(const task of batch) {
  const card=node('article',undefined,'issue');const category=task.feedback.category;
  card.append(node('span',categories[category],`category ${category}`),node('h3',task.feedback.title.replace(/^\[Demo feedback\]\s*/,'')));
  card.append(node('p',task.plan?.summary?.slice(0,320) || task.error || 'Summarizing feedback and checking the code…'));
  if(task.plan?.confidence) { const c=task.plan.confidence;card.append(node('p',`Issue confidence: ${c.issue} · ${c.legitimacy==='sample'?'Sample data':`Non-spam confidence: ${c.legitimacy}`}`,'state')); }
  card.append(node('div',`${task.signal?.reportCount || 1} reports · ${channels[category]}`,'channel'));
  const status=task.publication?.status==='published'?'Fix is live':task.publication?.status==='failed'?'Tests passed; publication needs attention':task.status==='failed'?'Investigation needs attention':task.plan?.disposition==='needs_clarification'?'More details needed':task.status==='changes_ready'?'Tested changes ready':task.discord?'Sent to Discord':task.plan?'Sending to the team…':'Investigation in progress';
  card.append(node('p',status,'state'));
  if(task.discord)card.append(link('Open in Discord ↗',`https://discord.com/channels/${task.discord.guildId}/${task.discord.channelId}/${task.discord.messageId}`));
  if(task.publication?.status==='published') {card.append(link('Open live update ↗',task.publication.url));if(state.hosted)card.append(link('Release evidence ↗',`/api/releases/${task.taskId}/record`),link('Code patch ↗',`/api/releases/${task.taskId}/patch`),link('Test output ↗',`/api/releases/${task.taskId}/tests`));}
  else if(!state.hosted&&task.status==='changes_ready')card.append(link('Try the update ↗',`${state.productUrl}/preview/${task.taskId}/`));
  $('#issues').append(card);
 }
 return true;
}
async function refresh() {
 try {
  state=await api('/api/tasks');
  showReviews(state.demoScenarios || []);
  const started=showIssues(state.tasks);
  const batch=state.batches?.[0];
  if(batch&&['pending','summarizing'].includes(batch.status))$('#notice').textContent='Summarizing all unprocessed reviews. Proposals will appear here and in Discord.';
  else if(batch?.status==='ready')$('#notice').textContent=batch.reportIds.length ? `${batch.reportIds.length} reports grouped into ${batch.taskIds.length} issues. Follow the proposals in Discord.` : 'No unprocessed feedback. New submissions will be included in the next run.';
  else if(batch?.status==='failed')$('#notice').textContent=`Summary needs attention: ${batch.error || 'Please retry.'}`;
  if(state.hosted&&!state.workerOnline)$('#notice').textContent='The engineering worker is offline. Feedback and workflow requests are saved until it reconnects.';
  $('#start').disabled=busy;
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
void refresh();setInterval(()=>{if(!document.hidden&&!busy)void refresh();},10000);
