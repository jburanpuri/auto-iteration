import { exportCsv } from './export.mjs';
const $ = selector => document.querySelector(selector);
const preview = location.pathname.startsWith('/preview/');
let pendingSubmission;
let state;
let rendered;
let busy = false;
const drafts = new Map();
const receipts = new Map();
const example = 'When I export an empty contact list, Northstar shows an error instead of downloading a CSV. I expected the export to work even when there are no contacts.';
function node(tag, text, className) {
  const item = document.createElement(tag); if (text !== undefined) item.textContent = text;
  if (className) item.className = className; return item;
}
function link(text, href, className) {
  const item = node('a', text, className); item.href = href; item.target = '_blank'; item.rel = 'noopener'; return item;
}
async function api(path, body) {
  const response = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Request failed.'); return data;
}
$('#preview-banner').hidden = !preview;
if (preview) { $('#bug-demo').open = true; }
$('#use-example').onclick = () => { $('#feedback-text').value = example; $('#feedback-text').focus(); };
$('#export').onclick = async () => {
  const notice = $('#export-notice'); notice.hidden = false;
  try {
    const csv = exportCsv([], ['name', 'email']);
    notice.className = 'notice success'; notice.textContent = 'Your contact export is ready.';
    notice.append(node('pre', csv || '(empty file)')); notice.lastChild.id = 'csv-output';
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const download = link('Download CSV', url); download.download = 'contacts.csv'; notice.append(download);
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (error) {
    notice.className = 'notice error'; notice.textContent = 'We couldn’t create your export. Please try again or send us feedback.';
    const report = node('button', 'Report this issue', 'text-button'); report.onclick = () => { $('#feedback-text').value = example; $('#feedback-text').focus(); }; notice.append(report);
    if (!preview) await api('/api/events', { id: crypto.randomUUID(), issue: 'csv_export', event: 'export_failed', rowCount: 0,
      message: error.message.slice(0, 1000), stack: error.stack?.slice(0, 3000) }).catch(() => {});
  }
};
$('#feedback-form').onsubmit = async event => {
  event.preventDefault();
  const text = $('#feedback-text').value.trim(); const reviewer = $('#reviewer').value.trim();
  if (!text || !reviewer) return;
  // The person's selection controls team routing; the agent still investigates the actual issue.
  const payload = { reviewer, text, title: text.slice(0, 100), category: $('#feedback-category').value };
  if (!pendingSubmission || JSON.stringify(pendingSubmission.payload) !== JSON.stringify(payload)) pendingSubmission = { payload, externalId: crypto.randomUUID() };
  $('#submit-feedback').disabled = true; $('#submit-state').textContent = 'Sending your feedback…';
  try {
    const result = await api('/api/feedback', { ...payload, externalId: pendingSubmission.externalId });
    pendingSubmission = undefined;
    $('#submit-state').textContent = result.status === 'quarantined'
      ? `Thanks, ${reviewer}. Your feedback was saved for review.`
      : `Thanks, ${reviewer}. Your feedback has been received. We appreciate you helping us improve Northstar.`;
    $('#feedback-text').value = ''; await refresh();
  } catch (error) { $('#submit-state').textContent = error.message; }
  finally { $('#submit-feedback').disabled = false; }
};
let pendingBatch;
$('#run-demo-batch').onclick = async () => {
  if (!state?.operator) return;
  pendingBatch ??= crypto.randomUUID();
  $('#run-demo-batch').disabled = true;
  $('#batch-state').textContent = 'Submitting sample feedback…';
  try {
    const result = await api('/api/operator/demo-batch', { batchId: pendingBatch });
    pendingBatch = undefined; $('#batch-state').textContent = result.message; await refresh();
  } catch (error) { $('#batch-state').textContent = error.message; }
  finally { $('#run-demo-batch').disabled = false; }
};
$('#seed-samples').onclick = async () => {
  $('#seed-samples').disabled = true;
  try { await api('/api/demo/samples', {}); await refresh(); }
  catch (error) { $('#submit-state').textContent = error.message; }
  finally { $('#seed-samples').disabled = false; }
};
const labels = { received: 'Feedback received', investigating: 'Investigating the code', discussing: 'Waiting for engineer review', revising: 'Revising the proposal', approved: 'Plan approved', implementing: 'Implementing & testing', changes_ready: 'Tested change ready', failed: 'Needs attention', declined: 'Plan declined' };
function details(title, items) {
  const section = node('details', undefined, 'plan-detail'); section.append(node('summary', title));
  for (const item of items) section.append(node('p', item)); return section;
}
function progress(task) {
  const level = task.status === 'changes_ready' ? 4 : ['approved', 'implementing'].includes(task.status) ? 3 : task.plan ? 2 : 1;
  const list = node('ol', undefined, 'progress');
  for (const [index, title] of ['Feedback received', 'Code investigated', 'Engineer approval', 'Tested fix'].entries()) {
    const item = node('li', undefined, index < level ? 'done' : ''); item.append(node('span', index < level ? '✓' : String(index + 1)), node('small', title)); list.append(item);
  }
  return list;
}
function taskCard(task) {
  const card = node('article', undefined, 'task'); card.dataset.task = task.taskId;
  card.append(node('div', labels[task.status], `status ${task.status}`), node('h3', task.feedback.title), progress(task));
  if (task.plan) {
    if (task.plan.classification) card.append(node('p', `${task.plan.classification.kind.replaceAll('_', ' ')} · ${task.plan.classification.issue}`, 'meta'));
    card.append(node('p', task.plan.summary, 'solution'), node('div', `Proposal v${task.plan.version} · ${task.plan.disposition === 'code_change' ? 'Code change' : 'Clarification needed'}`, 'meta'));
    card.append(details('What Codex found in the code', task.plan.evidence), details('Proposed implementation', task.plan.steps), details('How we’ll test it', task.plan.acceptanceCriteria));
  } else card.append(node('p', 'The worker will inspect the repository and available error logs. The proposal will appear here and in Discord when connected.', 'muted'));
  if (task.error) card.append(node('p', task.error, 'notice error'));
  if (task.discord) card.append(link('Review proposal in Discord ↗', `https://discord.com/channels/${task.discord.guildId}/${task.discord.channelId}/${task.discord.messageId}`, 'discord-link'));
  if (task.comments.length || task.agentNotes.length) {
    const thread = node('div', undefined, 'discussion'); thread.append(node('h4', 'Engineering discussion'));
    const messages = [...task.comments.map(item => ({ ...item, name: 'Engineer' })), ...task.agentNotes.map(item => ({ text: item.reply, at: item.at, name: 'Agent' }))].sort((a,b) => a.at.localeCompare(b.at));
    for (const message of messages) { const bubble = node('div', undefined, 'bubble'); bubble.append(node('strong', message.name), node('p', message.text)); thread.append(bubble); }
    card.append(thread);
  }
  if (state.operator && ['discussing', 'failed'].includes(task.status)) operatorControls(card, task);
  if (task.approval) card.append(node('p', `Approved plan v${task.approval.version} · ${new Date(task.approval.at).toLocaleTimeString()}`, 'meta'));
  if (task.status === 'changes_ready') {
    const links = node('div', undefined, 'result-links');
    links.append(link('Try the updated product ↗', `${state.productUrl || ''}/preview/${task.taskId}/`, 'submit'));
    links.append(link('View patch', `/api/tasks/${task.taskId}/patch`), link('Test results', `/api/tasks/${task.taskId}/tests`), link('Review summary', `/api/tasks/${task.taskId}/review`));
    card.append(links, node('p', 'Local review bundle. Remote PR publishing is not connected.', 'meta'));
  }
  card.append(details('Activity log', task.audit.map(event => `${new Date(event.at).toLocaleTimeString()} · ${event.type.replaceAll('.', ' ')}`)));
  return card;
}
function operatorControls(card, task) {
  const controls = node('div', undefined, 'controls'); const message = node('p', '', 'form-status');
  const version = task.plan?.version ?? 0;
  const send = async (action, body) => {
    busy = true; controls.querySelectorAll('button,textarea').forEach(item => item.disabled = true); message.textContent = action === 'comment' ? 'Comment saved; waiting for the agent…' : 'Processing…';
    try {
      const result = await api(`/api/operator/${task.taskId}/${action}`, body);
      if (action === 'comment') { drafts.delete(task.taskId); receipts.delete(task.taskId); }
      message.textContent = result.warning || 'Saved.';
      if (result.warning) window.alert(result.warning);
    } catch (error) { message.textContent = error.message; }
    finally { busy = false; controls.querySelectorAll('button,textarea').forEach(item => item.disabled = false); await refresh(); }
  };
  if (task.status === 'discussing') {
    const label = node('label', 'Discuss or request a change'); label.htmlFor = `comment-${task.taskId}`;
    const input = node('textarea'); input.id = label.htmlFor; input.rows = 3; input.maxLength = 8000;
    input.placeholder = 'Keep the column headers when exporting an empty list.'; input.value = drafts.get(task.taskId) || '';
    input.oninput = () => drafts.set(task.taskId, input.value);
    const comment = node('button', 'Send to agent', 'secondary'); comment.onclick = () => {
      const text = input.value.trim(); if (!text) { input.focus(); return; }
      const cached = receipts.get(task.taskId); const receipt = cached?.text === text ? cached : { text, receiptId: crypto.randomUUID() }; receipts.set(task.taskId, receipt);
      void send('comment', receipt);
    };
    controls.append(label, input, comment);
  }
  const actions = node('div', undefined, 'actions');
  const revise = node('button', task.status === 'failed' ? 'Retry investigation' : `Request revised plan v${version + 1}`, 'secondary'); revise.onclick = () => send('revise', { version }); actions.append(revise);
  if (task.status === 'discussing' && task.plan.disposition === 'code_change') {
    const approve = node('button', `Approve v${version} & implement`, 'submit');
    approve.disabled = task.plan.commentCount !== task.comments.length || task.plan.disposition !== 'code_change' || task.conversationPending;
    approve.onclick = () => send('approve', { version }); actions.append(approve);
    if (task.plan.commentCount !== task.comments.length) controls.append(node('p', 'Request a revised plan to include the latest discussion before approving.', 'muted'));
  }
  if (task.conversationPending) { revise.disabled = true; controls.append(node('p', 'The conversational agent is replying…', 'muted')); }
  controls.append(actions, message); card.append(controls);
}
async function refresh() {
  if (busy) return;
  try {
    state = await api('/api/tasks');
    if (state.operator && !$('#batch-examples').childElementCount) {
      const categories = { general: 'General', ui_ux: 'UI/UX issue', performance: 'Performance' };
      for (const scenario of state.demoScenarios || []) for (const name of scenario.names) {
        const sample = node('article', undefined, 'review');
        sample.append(node('small', `SAMPLE · ${categories[scenario.category]}`), node('h4', `${name}: ${scenario.title}`), node('p', scenario.text));
        $('#batch-examples').append(sample);
      }
    }
    $('#mode').textContent = state.mode === 'codex' ? 'LIVE CODEX' : 'SCRIPTED REHEARSAL';
    $('#connection').textContent = state.operator ? 'Local engineer fallback · You are acting as the trusted demo operator.' : state.discord
      ? 'Discord connected. Engineers receive the proposal there and can approve or request changes.'
      : 'Discord is not connected. The proposal will appear here; use the local engineer console to rehearse approval.';
    if (state.operator) { $('.activity').hidden = false; $('.review-inbox').hidden = false; $('#company-note').hidden = true; $('#submission-panel').hidden = true; $('.layout').classList.add('operator-layout'); $('#activity-title').textContent = 'Engineer review'; $('h1').textContent = 'Review. Refine. Approve.'; $('.lede').textContent = 'A local fallback for rehearsing the same approval workflow used in Discord.'; }
    const fallback = $('#operator-link'); fallback.replaceChildren();
    if (state.operator && state.productUrl) fallback.append(link('Open Northstar ↗', state.productUrl, 'fallback-link'));
    if (!state.operator) return;
    const signature = JSON.stringify([state.tasks, state.reviews]);
    if (signature === rendered) return;
    // Preserve open evidence panels and unsent comments across polling updates.
    const openDetails = new Set([...document.querySelectorAll('.task details[open]')].map(item => `${item.closest('.task').dataset.task}:${item.querySelector('summary').textContent}`));
    const focus = document.activeElement; if (focus?.tagName === 'TEXTAREA' && focus.closest('.controls')) return;
    rendered = signature;
    const list = $('#tasks'); list.replaceChildren();
    if (!state.tasks.length) { const empty = node('div', undefined, 'empty'); empty.append(node('span', '↗', 'empty-icon'), node('h3', 'Your next improvement starts here.'), node('p', 'Leave feedback to see the investigation, proposed solution, and engineer decision in one place.')); list.append(empty); }
    for (const task of state.tasks) list.append(taskCard(task));
    document.querySelectorAll('.task details').forEach(item => { item.open = openDetails.has(`${item.closest('.task').dataset.task}:${item.querySelector('summary').textContent}`); });
    const reviews = $('#reviews'); reviews.replaceChildren();
    if (!state.reviews.length) reviews.append(node('p', 'No feedback yet. Optional samples demonstrate grouping and spam filtering.', 'muted'));
    for (const review of state.reviews) { const item = node('article', undefined, 'review'); item.append(node('span', `${review.sample ? 'SAMPLE · ' : ''}${review.disposition}`, `review-status ${review.disposition}`), node('h4', review.feedback.title), node('p', review.feedback.text), node('small', review.reason)); reviews.append(item); }
  } catch (error) { $('#connection').textContent = error.message; }
}
void refresh(); setInterval(() => void refresh(), 2500);
