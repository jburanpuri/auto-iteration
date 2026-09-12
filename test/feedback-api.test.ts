import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { feedbackServer } from '../src/feedback-api.js';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { DemoProvider } from '../src/providers.js';
import { seedRepository } from '../src/seed.js';

const feedback = { externalId: 'api-review-1', title: 'CSV export crashes', text: 'An empty customer list crashes when I export CSV.' };
async function setup(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'auto-iteration-http-'));
  const repo = await seedRepository(root);
  const store = new Store(join(root, 'state.sqlite'));
  const engine = new Engine(store, 'api-demo', repo, new DemoProvider(), root);
  const token = randomBytes(32).toString('hex');
  const server = feedbackServer(engine, token);
  t.after(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close(); await rm(root, { recursive: true, force: true });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const post = (body: unknown) => fetch(`${base}/api/feedback`, { method: 'POST', headers, body: JSON.stringify(body) });
  return { base, headers, post, engine, store };
}

test('HTTP feedback becomes a proposal, then a tested change after separate engineer approval', async t => {
  const { post, base, headers, engine } = await setup(t);
  const accepted = await post(feedback);
  assert.equal(accepted.status, 202);
  const body = await accepted.json() as { taskId: string; statusUrl: string };
  assert.equal(accepted.headers.get('location'), body.statusUrl);
  await engine.drain();
  const proposed = await fetch(`${base}${body.statusUrl}`, { headers });
  const task = await proposed.json() as { status: string; plan: { version: number }; approval: unknown };
  assert.equal(task.status, 'discussing');
  assert.equal(task.approval, null);
  engine.approve(body.taskId, { id: 'lead', organizationId: 'api-demo', canApprove: true }, task.plan.version);
  await engine.drain();
  const completed = await fetch(`${base}${body.statusUrl}`, { headers });
  assert.equal((await completed.json() as { status: string }).status, 'changes_ready');
});

test('HTTP intake authenticates clients and exposes no approval route', async t => {
  const { base, headers, store } = await setup(t);
  assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', body: JSON.stringify(feedback) })).status, 401);
  assert.equal(store.list('api-demo').length, 0);
  assert.equal((await fetch(`${base}/api/tasks/00000000-0000-0000-0000-000000000000`, { headers })).status, 404);
  assert.equal((await fetch(`${base}/api/approve`, { method: 'POST', headers, body: '{}' })).status, 404);
});

test('HTTP retries reuse a task, conflicting IDs and tenant/source overrides are rejected', async t => {
  const { post, store } = await setup(t);
  const first = await (await post(feedback)).json() as { taskId: string };
  const duplicate = await post(feedback);
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json() as { taskId: string }).taskId, first.taskId);
  assert.equal((await post({ ...feedback, text: 'Different report' })).status, 409);
  assert.equal((await post({ ...feedback, organizationId: 'another-company' })).status, 400);
  assert.equal((await post({ ...feedback, source: 'slack' })).status, 400);
  assert.equal(store.list('api-demo').length, 1);
});

test('HTTP intake rejects malformed, oversized, and non-JSON submissions', async t => {
  const { base, headers, post } = await setup(t);
  assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetch(`${base}/api/feedback`, { method: 'POST', headers: { ...headers, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
  assert.equal((await post({ ...feedback, text: 'x'.repeat(70_000) })).status, 413);
  assert.equal((await post({ ...feedback, text: '' })).status, 400);
});
