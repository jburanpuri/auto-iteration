import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Engine } from '../src/engine.js';
import { Store } from '../src/store.js';
import { DemoProvider } from '../src/providers.js';
import { seedRepository } from '../src/seed.js';
import { DiscordController, parseDiscordCommand, type DiscordInput } from '../src/discord-controller.js';
import { routeChannel, splitDiscordText } from '../src/discord.js';
import { feedbackServer } from '../src/feedback-api.js';
import { OpenRouterConversation } from '../src/conversation.js';
import type { ConversationReply } from '../src/conversation.js';
import type { Task } from '../src/domain.js';
import { formatDiscordTask } from '../src/format.js';

const report = { source: 'demo-http', externalId: 'r1', title: 'CSV export crashes', text: 'No customers: CSV export throws.' };
const lead = { id: 'lead', organizationId: 'team', canApprove: true };
async function setup(t: TestContext, provider = new DemoProvider()) {
  const root = await mkdtemp(join(tmpdir(), 'orbit-test-'));
  const repo = await seedRepository(root, true);
  const store = new Store(join(root, 'state.sqlite'));
  const engine = new Engine(store, 'team', repo, provider, root);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  return { root, repo, store, engine };
}
function transport() {
  const sent: { id: string; text: string; replyTo?: string }[] = [];
  return { sent, async send(text: string, replyTo?: string) { const id = `out-${sent.length}`; sent.push({ id, text, replyTo }); return [id]; } };
}
const input = (id: string, content: string, extra: Partial<DiscordInput> = {}): DiscordInput => ({ id, content,
  guildId: 'guild', channelId: 'general', authorId: 'engineer', bot: false, ...extra });

test('three reports escalate atomically, duplicate deliveries do not inflate the signal, windows and repositories stay separate', async t => {
  const { engine, store } = await setup(t);
  assert.equal(engine.report(report, 'csv_export').reportCount, 1);
  assert.equal(engine.report(report, 'csv_export').reportCount, 1);
  assert.equal(engine.pendingJobs().length, 0);
  assert.throws(() => engine.report({ ...report, text: 'Changed' }, 'csv_export'), /different content/);
  assert.equal(engine.report({ ...report, externalId: 'r2' }, 'csv_export').task, undefined);
  const result = engine.report({ ...report, externalId: 'r3' }, 'csv_export');
  assert.equal(result.task?.signal?.reportCount, 3);
  assert.equal(engine.pendingJobs().length, 1);
  assert.equal(engine.report(report, 'csv_export').task?.id, result.task?.id);
  assert.equal(store.complaintCounts('elsewhere', engine.repo.id, '2000').length, 0);
  assert.equal(store.complaintCounts('team', 'another-repo', '2000').length, 0);
  const later = new Engine(store, 'team', engine.repo, engine.provider, engine.root, () => new Date(Date.now() + 31 * 60_000));
  assert.equal(later.report({ ...report, externalId: 'later' }, 'csv_export').reportCount, 1);
});

test('Discord sends one result to the owning team and enforces human versioned approval', async t => {
  class Routed extends DemoProvider {
    override async investigate(...args: Parameters<DemoProvider['investigate']>) {
      return { ...await super.investigate(...args), team: 'performance' as const, routingReason: 'Test routing result.' };
    }
  }
  const { engine, store } = await setup(t, new Routed());
  const channels = { engineering: 'general', ui_ux: 'ux', performance: 'perf' };
  const generalOut = transport(), perfOut = transport();
  const base = { guildId: 'guild', approverIds: new Set(['lead']), botId: '123', route: (task: ReturnType<Engine['get']>) => routeChannel(task, channels) };
  const general = new DiscordController(engine, { ...base, channelId: 'general' }, generalOut);
  const perf = new DiscordController(engine, { ...base, channelId: 'perf' }, perfOut);
  t.after(async () => { await general.stop(); await perf.stop(); });
  const task = engine.submit(report).task;
  await general.sync(); assert.equal(generalOut.sent.length, 0);
  await engine.drain(); await general.sync(); await perf.sync();
  assert.equal(engine.get(task.id).discord?.channelId, 'perf');
  const rootMessage = engine.get(task.id).discord!.messageId;
  const message = (id: string, content: string, authorId = 'engineer') => input(id, content, { channelId: 'perf', replyTo: rootMessage, authorId });
  await perf.handle(message('unauthorized', '<@123> approve 1'));
  assert.equal(engine.get(task.id).status, 'discussing');
  await perf.handle(message('comment', 'Keep the headers, please.'));
  await perf.handle(message('comment', 'Keep the headers, please.'));
  assert.equal(engine.get(task.id).comments.length, 1);
  await perf.handle(message('stale-context', '<@123> approve 1', 'lead'));
  assert.equal(engine.get(task.id).status, 'discussing');
  await perf.handle(message('revise', '<@123> revise 1'));
  await engine.drain();
  await perf.handle(message('stale-version', '<@123> approve 1', 'lead'));
  assert.equal(engine.get(task.id).status, 'discussing');
  await perf.handle(message('approve', '<@123> approve 2', 'lead'));
  await perf.handle(message('approve', '<@123> approve 2', 'lead'));
  assert.equal(engine.pendingJobs().length, 1);
  await engine.drain(); await perf.sync();
  assert.equal(engine.get(task.id).status, 'changes_ready');
  assert.ok(store.audit(task.id, 'team').some(event => event.type === 'proposal.approved' && event.actor === 'lead'));
  assert.equal(routeChannel({ ...engine.get(task.id), plans: [] }, channels), 'perf');
});

test('Discord rejects other channels, bots, ambiguous replies and approval embedded in prose', async t => {
  const { engine } = await setup(t);
  const out = transport();
  const controller = new DiscordController(engine, { guildId: 'guild', channelId: 'general', botId: '123', approverIds: new Set(['lead']) }, out);
  t.after(() => controller.stop());
  await controller.handle(input('bad', '<@123> feedback CSV export', { guildId: 'other' }));
  await controller.handle(input('bot', '<@123> feedback CSV export', { bot: true }));
  assert.equal(engine.pendingJobs().length, 0);
  engine.submit(report); engine.submit({ ...report, externalId: 'second' });
  await engine.drain(); await controller.sync();
  await controller.handle(input('ambiguous', 'Keep column headers'));
  assert.match(out.sent.at(-1)!.text, /Several feedback tasks/);
  assert.equal(engine.store.list('team').flatMap(task => task.comments).length, 0);
  assert.equal(parseDiscordCommand('We should <@123> approve 1', '123'), undefined);
  assert.throws(() => parseDiscordCommand('<@123> approve 1 and deploy', '123'), /exact version/);
});

test('product UI records real log payloads, groups feedback, serves a changed preview, and protects API access', async t => {
  const { engine, repo, root } = await setup(t);
  const server = feedbackServer(engine, 'a'.repeat(32), { productUI: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await fetch(base); assert.match(await page.text(), /Northstar/);
  const headers = { Cookie: page.headers.get('set-cookie')!.split(';')[0]!, 'Content-Type': 'application/json' };
  assert.equal((await fetch(`${base}/api/tasks`)).status, 401);
  const badHost = await new Promise<number | undefined>((resolve, reject) => {
    request(base, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); }).on('error', reject).end();
  });
  assert.equal(badHost, 403);
  assert.equal((await fetch(`${base}/api/events`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(`${base}/api/events`, { method: 'POST', headers,
    body: JSON.stringify({ id: randomUUID(), issue: 'csv_export', event: 'export_failed', message: 'Cannot convert undefined or null to object', rowCount: 0 }) })).status, 202);
  for (let i = 0; i < 3; i++) assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', headers,
    body: JSON.stringify({ externalId: `ui-${i}`, title: report.title, text: report.text, issue: 'csv_export' }) })).status, 202);
  const task = engine.store.list('team')[0]!;
  assert.equal(engine.evidence(task).logs.length, 1);
  assert.equal((await fetch(`${base}/preview/${task.id}/`)).status, 404);
  await engine.drain(); engine.comment(task.id, lead, 'Keep the headers'); engine.revise(task.id, lead, 1);
  await engine.drain(); engine.approve(task.id, lead, 2); await engine.drain();
  assert.equal((await fetch(`${base}/preview/${task.id}/`)).status, 200);
  assert.match(await (await fetch(`${base}/preview/${task.id}/export.mjs`)).text(), /rows.length \?/);
  assert.doesNotMatch(await (await fetch(`${base}/export.mjs`)).text(), /rows.length \?/);
  assert.equal((await fetch(`${base}/api/tasks/${task.id}/patch`, { headers })).status, 200);
  const outside = join(root, 'outside.mjs');
  await writeFile(outside, 'This file must not be served.');
  await symlink(outside, join(repo.path, 'escape.mjs'));
  assert.equal((await fetch(`${base}/escape.mjs`)).status, 404);
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
});

test('the logs MCP exposes only the supplied snapshot and filters events', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'orbit-mcp-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'evidence.json');
  await writeFile(path, JSON.stringify({ signal: { reportCount: 3 }, logs: [
    { event: 'export_failed', message: 'Actual browser error' }, { event: 'search_completed', durationMs: 902 },
  ] }));
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [resolve('src/observability-mcp.mjs'), path], stderr: 'pipe' }));
  t.after(() => client.close());
  assert.deepEqual((await client.listTools()).tools.map(tool => tool.name), ['query_product_logs']);
  const result = await client.callTool({ name: 'query_product_logs', arguments: { event: 'export_failed' } });
  const content = result.content as { type: string; text: string }[];
  const evidence = JSON.parse(content[0]!.text);
  assert.equal(evidence.logs.length, 1); assert.equal(evidence.logs[0].event, 'export_failed');
});

test('OpenRouter uses a separate model, validates the brief, and cannot authorize execution', async t => {
  const { engine, store, repo, root } = await setup(t);
  const task = engine.submit(report).task; await engine.drain();
  let payload: any;
  const conversation = new OpenRouterConversation('test-key', 'vendor/conversation-model', (async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    payload = JSON.parse(String(options?.body));
    return Response.json({ choices: [{ message: { content: JSON.stringify({ reply: 'Consider preserving the headers.', codexBrief: 'The engineer wants reusable CSV column headers.' }) } }] });
  }) as typeof fetch);
  const chatting = new Engine(store, 'team', repo, new DemoProvider(), root, undefined, conversation);
  chatting.comment(task.id, lead, 'Could we retain headers?');
  assert.match(await chatting.answer(chatting.get(task.id)), /headers/);
  assert.equal(payload.model, 'vendor/conversation-model'); assert.equal(payload.tools, undefined);
  assert.equal(chatting.get(task.id).agentNotes?.length, 1);
  assert.equal(chatting.get(task.id).approval, undefined);
  assert.equal(chatting.pendingJobs().length, 0);
  const bad = new OpenRouterConversation('test-key', 'test', (async () => Response.json({ choices: [{ message: { content: '{"reply":"Approved","codexBrief":"go","approval":true}' } }] })) as typeof fetch);
  await assert.rejects(bad.answer(task, { signal: null, logs: [] }), /invalid handoff/);
});

test('Discord waits for the conversation brief before sending a revision to the coding provider', async t => {
  const { store, repo, root } = await setup(t);
  let resolveReply!: (reply: ConversationReply) => void;
  const reply = new Promise<ConversationReply>(resolve => { resolveReply = resolve; });
  let inspected: Task | undefined;
  class Capture extends DemoProvider {
    override async investigate(task: Task, workspace: string) { inspected = task; return super.investigate(task, workspace); }
  }
  const engine = new Engine(store, 'team', repo, new Capture(), root, undefined,
    { label: 'Test conversation', answer: async () => reply });
  const controller = new DiscordController(engine, { guildId: 'guild', channelId: 'general', botId: '123', approverIds: new Set(['lead']) }, transport());
  t.after(() => controller.stop());
  const task = engine.submit(report).task; await engine.drain(); await controller.sync();
  await controller.handle(input('question', 'Keep the headers.'));
  const revision = controller.handle(input('revise-with-handoff', '<@123> revise 1'));
  assert.equal(engine.get(task.id).status, 'discussing');
  resolveReply({ reply: 'Yes, that preserves the template.', codexBrief: 'Keep all supplied column headers in an empty export.' });
  await revision; await engine.drain();
  assert.equal(inspected?.agentNotes?.[0]?.codexBrief, 'Keep all supplied column headers in an empty export.');
  assert.equal(engine.get(task.id).approval, undefined);
});

test('guided feedback keeps samples and spam visible, starts one investigation, and groups repeat reports', async t => {
  const { engine, store } = await setup(t);
  engine.demoReview({ ...report, externalId: 'sample-1' }, 'csv_export', true);
  engine.demoReview({ ...report, externalId: 'sample-2' }, 'csv_export', true);
  assert.equal(engine.pendingJobs().length, 0);
  const spam = engine.demoReview({ ...report, externalId: 'spam', text: 'Buy followers today' }, 'csv_export', true);
  assert.equal(spam.review.disposition, 'quarantined');
  assert.equal(engine.pendingJobs().length, 0);
  const first = engine.demoReview(report, 'csv_export');
  assert.ok(first.review.taskId);
  assert.equal(engine.get(first.review.taskId!).signal?.reportCount, 3);
  assert.match(engine.get(first.review.taskId!).feedback.text, /\[Sample\]/);
  assert.equal(engine.pendingJobs().length, 1);
  assert.equal(engine.demoReview(report, 'csv_export').duplicate, true);
  assert.throws(() => engine.demoReview({ ...report, text: 'Changed' }, 'csv_export'), /different content/);
  const grouped = engine.demoReview({ ...report, externalId: 'repeat' }, 'csv_export');
  assert.equal(grouped.review.taskId, first.review.taskId);
  assert.equal(grouped.review.disposition, 'grouped');
  assert.equal(engine.pendingJobs().length, 1);
  assert.equal(store.reviews('another-team', engine.repo.id).length, 0);
  const feature = engine.demoReview({ ...report, externalId: 'feature', text: 'Add a dark theme' });
  assert.equal(feature.review.disposition, 'investigating');
  assert.ok(feature.review.taskId);
  const other = engine.demoReview({ ...report, externalId: 'live-other-1', text: 'Search freezes' });
  const unrelated = engine.demoReview({ ...report, externalId: 'live-other-2', text: 'Add keyboard shortcuts' });
  assert.ok(other.review.taskId);
  assert.notEqual(other.review.taskId, unrelated.review.taskId);
  const differentExport = engine.demoReview({ ...report, externalId: 'slow-export', text: 'Populated exports take ten seconds.' }, 'csv_export');
  assert.notEqual(differentExport.review.taskId, first.review.taskId);
  const spamBug = engine.demoReview({ ...report, externalId: 'spam-handling', text: 'The form accepts buy followers spam; please improve reporting controls.' });
  assert.equal(spamBug.review.disposition, 'investigating');
});

test('unclassified feedback reaches the provider and returns classification and team without bypassing approval', async t => {
  class Arbitrary extends DemoProvider {
    override async investigate(task: Task) {
      assert.match(task.feedback.text, /Reported by Maya/);
      return {
        classification: { kind: 'usability' as const, issue: 'Feedback form has no keyboard focus indicator' },
        disposition: 'code_change' as const, team: 'ui_ux' as const, routingReason: 'Keyboard focus is an accessibility concern.',
        summary: 'Add a visible keyboard focus indicator.', evidence: ['Test provider inspected the submitted report.'],
        steps: ['Add focus-visible styling.'], acceptanceCriteria: ['Keyboard users can see the focused control.'],
      };
    }
  }
  const { engine } = await setup(t, new Arbitrary());
  const server = feedbackServer(engine, 'a'.repeat(32), { productUI: true, guidedDemo: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const cookie = (await fetch(base)).headers.get('set-cookie')!.split(';')[0]!;
  const headers = { Cookie: cookie, 'Content-Type': 'application/json' };
  const feedback = { externalId: 'keyboard-focus', reviewer: 'Maya', title: 'Invisible keyboard focus', text: 'I cannot see which form control is focused when using Tab.' };
  const response = await fetch(`${base}/api/feedback`, { method: 'POST', headers, body: JSON.stringify(feedback) });
  assert.equal(response.status, 202);
  const accepted = await response.json() as { taskId: string; status: string };
  assert.equal(accepted.status, 'investigating');
  await engine.drain();
  const task = engine.get(accepted.taskId);
  assert.equal(task.status, 'discussing');
  assert.equal(task.plans[0]?.classification?.kind, 'usability');
  assert.equal(routeChannel(task, { engineering: 'core', performance: 'perf', ui_ux: 'design' }), 'design');
  assert.equal(task.approval, undefined);
  assert.equal(task.result, undefined);
  const retry = await fetch(`${base}/api/feedback`, { method: 'POST', headers, body: JSON.stringify(feedback) });
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { taskId: string }).taskId, task.id);
});

test('separate operator origin gates versioned approval and completes the feedback-to-preview flow', async t => {
  const { engine } = await setup(t);
  const product = feedbackServer(engine, 'p'.repeat(32), { productUI: true, guidedDemo: true });
  const operator = feedbackServer(engine, 'o'.repeat(32), { productUI: true, guidedDemo: true, operatorUI: true });
  for (const server of [product, operator]) { server.listen(0, '127.0.0.1'); await once(server, 'listening'); }
  t.after(async () => { await Promise.all([product, operator].map(server => new Promise<void>(resolve => server.close(() => resolve())))); });
  const url = (server: typeof product) => `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const productUrl = url(product), operatorUrl = url(operator);
  const cookie = async (base: string) => (await fetch(base)).headers.get('set-cookie')!.split(';')[0]!;
  const productHeaders = { Cookie: await cookie(productUrl), 'Content-Type': 'application/json' };
  const operatorHeaders = { Cookie: await cookie(operatorUrl), 'Content-Type': 'application/json', Origin: operatorUrl };
  const submit = await fetch(`${productUrl}/api/feedback`, { method: 'POST', headers: productHeaders, body: JSON.stringify({
    externalId: 'named-user', reviewer: 'Maya', title: report.title, text: report.text, issue: 'csv_export',
  }) });
  const { taskId } = await submit.json() as { taskId: string };
  assert.match(engine.get(taskId).feedback.title, /Maya/);
  await engine.drain();
  const action = (kind: string, body: unknown, headers = operatorHeaders, base = operatorUrl) => fetch(`${base}/api/operator/${taskId}/${kind}`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  assert.equal((await action('approve', { version: 1 }, productHeaders as typeof operatorHeaders, productUrl)).status, 404);
  assert.equal((await action('approve', { version: 1 }, { ...operatorHeaders, Origin: productUrl })).status, 403);
  assert.equal((await action('approve', { version: 1 }, { ...operatorHeaders, Origin: '' })).status, 403);
  assert.equal((await action('approve', { version: 99 })).status, 409);
  const comment = { text: 'Keep the CSV column headers', receiptId: randomUUID() };
  assert.equal((await action('comment', comment)).status, 200);
  assert.equal((await action('comment', comment)).status, 200);
  assert.equal(engine.get(taskId).comments.length, 1);
  assert.equal(engine.get(taskId).agentNotes?.length, 1);
  assert.equal((await action('approve', { version: 1 })).status, 409);
  assert.equal((await action('revise', { version: 1 })).status, 200);
  await engine.drain();
  assert.equal((await action('approve', { version: 1 })).status, 409);
  assert.equal((await action('approve', { version: 2 })).status, 200);
  await engine.drain();
  assert.equal(engine.get(taskId).status, 'changes_ready');
  assert.equal((await fetch(`${productUrl}/preview/${taskId}/`)).status, 200);
  assert.equal((await fetch(`${operatorUrl}/preview/${taskId}/`)).status, 404);
  assert.match(await (await fetch(`${productUrl}/preview/${taskId}/export.mjs`)).text(), /rows.length \?/);
});

test('Discord proposal includes approval controls and request changes sends engineer feedback to a new Codex plan', async t => {
  const { engine } = await setup(t);
  const controls: { taskId: string; version: number }[] = [];
  const out = transport();
  const controller = new DiscordController(engine, { guildId: 'guild', channelId: 'general', botId: '123', approverIds: new Set(['lead']) }, {
    async send(text, replyTo, buttons) { if (buttons) controls.push(buttons); return out.send(text, replyTo); },
  });
  const task = engine.submit(report).task; await engine.drain(); await controller.sync();
  assert.deepEqual(controls[0], { taskId: task.id, version: 1, canApprove: true, needsClarification: false });
  assert.equal(out.sent.length, 1);
  assert.match(out.sent[0]!.text, /Code evidence:/);
  assert.doesNotMatch(out.sent[0]!.text, /Task:|Expires:|Implementation plan:/);
  assert.equal(splitDiscordText(out.sent[0]!.text).length, 1);
  await controller.sync(); assert.equal(out.sent.length, 1);
  await controller.handle(input('change-request', '<@123> changes 1 Keep the headers.'));
  assert.equal(engine.get(task.id).status, 'revising');
  await engine.drain(); await controller.sync();
  assert.equal(engine.get(task.id).plans.at(-1)?.version, 2);
  assert.match(engine.get(task.id).plans.at(-1)!.summary, /headers/);
  await controller.handle(input('stale-change', '<@123> changes 1 Remove the headers.'));
  assert.equal(engine.get(task.id).comments.length, 1);
  await controller.handle(input('approve-final', '<@123> approve 2', { authorId: 'lead' }));
  await engine.drain();
  assert.equal(engine.get(task.id).status, 'changes_ready');
  await controller.stop();
});

test('feedback category persists through HTTP and wins over model routing; categories do not merge', async t => {
  const { engine } = await setup(t);
  const server = feedbackServer(engine, 'c'.repeat(32), { productUI: true, guidedDemo: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await fetch(base);
  const headers = { Cookie: page.headers.get('set-cookie')!.split(';')[0]!, 'Content-Type': 'application/json' };
  const routes = { engineering: 'core', ui_ux: 'design', performance: 'perf' };
  for (const [category, channel] of [['ui_ux', 'design'], ['performance', 'perf'], ['general', 'core']] as const) {
    const response = await fetch(`${base}/api/feedback`, { method: 'POST', headers, body: JSON.stringify({
      externalId: `category-${category}`, reviewer: 'Maya', title: report.title, text: report.text, category,
    }) });
    assert.equal(response.status, 202);
    const { taskId } = await response.json() as { taskId: string };
    assert.equal(engine.get(taskId).feedback.category, category);
    assert.equal(routeChannel(engine.get(taskId), routes), channel);
    await engine.drain();
    // The fixture suggests engineering for every report. Explicit categories still win.
    assert.equal(routeChannel(engine.get(taskId), routes), channel);
  }
  assert.equal(engine.store.list('team').length, 3);
  assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', headers, body: JSON.stringify({
    externalId: 'bad-category', title: report.title, text: report.text, category: 'sales',
  }) })).status, 400);
});

test('clarification and non-code results stay concise and never offer approval', async t => {
  const { engine } = await setup(t);
  const task = engine.submit(report).task; await engine.drain();
  engine.store.mutate(task.id, engine.organizationId, { type: 'test.clarification', actor: 'test', at: new Date().toISOString() }, current => {
    const plan = current.plans[0]!;
    plan.disposition = 'needs_clarification';
    plan.summary = 'The reported dropdown could not be located in this checkout.';
    plan.steps = ['Clarify: Which page and dropdown do you mean?', 'Clarify: What happens when you click it?', 'Investigate once the control is identified.'];
  });
  const out = transport();
  const buttons: any[] = [];
  const config = { guildId: 'guild', channelId: 'general', botId: '123', approverIds: new Set(['lead']) };
  const controller = new DiscordController(engine, config, {
    async send(text, replyTo, controls) { buttons.push(controls); return out.send(text, replyTo); },
  });
  await controller.sync(); await controller.sync();
  assert.equal(out.sent.length, 1);
  assert.equal(buttons[0].canApprove, false);
  assert.equal(buttons[0].needsClarification, true);
  assert.match(out.sent[0]!.text, /Which page and dropdown/);
  assert.doesNotMatch(out.sent[0]!.text, /Acceptance criteria|Code evidence|Implementation plan|Expires:|Approve plan/);
  const restarted = new DiscordController(engine, config, out);
  await restarted.sync(); assert.equal(out.sent.length, 1);
  engine.store.mutate(task.id, engine.organizationId, { type: 'test.noncode', actor: 'test', at: new Date().toISOString() }, current => {
    current.plans[0]!.version = 2; current.plans[0]!.disposition = 'non_code';
  });
  await controller.sync();
  assert.equal(buttons[1], undefined);
  assert.match(out.sent[1]!.text, /No code change proposed/);
});

test('Discord summaries fit one message and long conversations split on readable boundaries', async t => {
  const { engine } = await setup(t);
  const task = engine.submit(report).task; await engine.drain();
  const current = engine.get(task.id);
  current.feedback.title = 'Long feedback '.repeat(100);
  const plan = current.plans[0]!;
  plan.summary = 'A proposed behavior change. '.repeat(200);
  plan.evidence = ['export.mjs:2 ' + 'A code observation. '.repeat(200)];
  plan.acceptanceCriteria = ['Expected behavior. '.repeat(200)];
  const summary = formatDiscordTask(current, 'http://127.0.0.1:4349/');
  assert.equal(splitDiscordText(summary).length, 1);
  assert.ok(summary.length < 1900);
  const chunks = splitDiscordText(('A complete paragraph of discussion. '.repeat(40) + '\n\n').repeat(4));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.length <= 1900));
});

test('preloaded feedback stays idle until Start, then retries queue only three grouped team investigations', async t => {
  const { engine } = await setup(t);
  const server = feedbackServer(engine, 'b'.repeat(32), { productUI: true, guidedDemo: true, operatorUI: true });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const page = await fetch(base);
  const headers = { Cookie: page.headers.get('set-cookie')!.split(';')[0]!, 'Content-Type': 'application/json', Origin: base };
  const state = await (await fetch(`${base}/api/tasks`, { headers })).json() as { demoScenarios: { names: string[] }[] };
  assert.equal(state.demoScenarios.flatMap(item => item.names).length, 120);
  assert.equal(engine.pendingJobs().length, 0);
  const batchId = randomUUID();
  const start = () => fetch(`${base}/api/operator/demo-batch`, { method: 'POST', headers, body: JSON.stringify({ batchId }) });
  const first = await (await start()).json() as { taskIds: string[]; feedbackCount: number };
  const retry = await (await start()).json() as { taskIds: string[] };
  assert.equal(first.feedbackCount, 120);
  assert.equal(first.taskIds.length, 3);
  assert.deepEqual(retry.taskIds, first.taskIds);
  assert.equal(engine.pendingJobs().length, 3);
  const tasks = first.taskIds.map(id => engine.get(id));
  assert.deepEqual(tasks.map(task => routeChannel(task, { engineering: 'core', ui_ux: 'design', performance: 'perf' })), ['core', 'design', 'perf']);
  assert.ok(tasks.every(task => task.signal?.reportCount === 40 && task.feedback.title.startsWith('[Demo feedback]')));
  assert.match(tasks[0]!.feedback.text, /Alex Chen/); assert.match(tasks[0]!.feedback.text, /Taylor Chen/);
  assert.equal(engine.store.reviews('team', engine.repo.id).length, 120);
  assert.equal((await fetch(`${base}/api/operator/demo-batch`, { method: 'POST', headers: {...headers, Origin:'http://127.0.0.1:1'}, body: JSON.stringify({batchId:randomUUID()}) })).status, 403);
});
