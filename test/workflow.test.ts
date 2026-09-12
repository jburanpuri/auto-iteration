import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Store } from '../src/store.js';
import { Engine } from '../src/engine.js';
import { DemoProvider, type EngineeringProvider } from '../src/providers.js';
import { seedRepository, fixtureBug } from '../src/seed.js';
import { command } from '../src/git.js';

const feedback = { source: 'support', externalId: 'ticket-1', title: 'CSV export crashes', text: 'Exporting an empty result crashes.' };
const engineer = { id: 'engineer', organizationId: 'acme', canApprove: false };
const lead = { id: 'lead', organizationId: 'acme', canApprove: true };

async function setup(t: TestContext, provider: EngineeringProvider = new DemoProvider(), clock?: () => Date) {
  const root = await mkdtemp(join(tmpdir(), 'auto-iteration-test-'));
  const repo = await seedRepository(root);
  const dbPath = join(root, 'state.sqlite');
  const store = new Store(dbPath);
  t.after(async () => { store.close(); await rm(root, { recursive: true, force: true }); });
  const engine = new Engine(store, 'acme', repo, provider, root, clock);
  const { task } = engine.submit(feedback);
  return { root, repo, store, engine, id: task.id, dbPath };
}

test('feedback → discussion → approved v2 → real tested patch, with persistent history', async t => {
  const { engine, store, repo, id, dbPath } = await setup(t);
  await engine.drain();
  assert.equal(engine.get(id).status, 'discussing');
  assert.equal(engine.pendingJobs().length, 0);
  engine.comment(id, engineer, 'Keep column headers when the result is empty.');
  assert.throws(() => engine.approve(id, lead, 1), /New discussion/);
  engine.revise(id, engineer, 1);
  await engine.drain();
  assert.equal(engine.get(id).plans.length, 2);
  engine.approve(id, lead, 2);
  await engine.drain();
  const task = engine.get(id);
  assert.equal(task.status, 'changes_ready', task.error);
  assert.ok(task.result);
  const patch = await readFile(task.result.patchPath, 'utf8');
  assert.match(patch, /rows.length/);
  assert.match(patch, /empty-export.test.mjs/);
  assert.match(await readFile(task.result.testOutputPath, 'utf8'), /# pass 3/);
  assert.equal(await readFile(join(repo.path, 'export.mjs'), 'utf8'), fixtureBug);
  assert.equal((await command(repo.path, 'git', ['status', '--porcelain'])).trim(), '');
  const reopened = new Store(dbPath);
  try {
    assert.equal(reopened.get(id, 'acme').approval?.version, 2);
    assert.equal(reopened.get(id, 'acme').result?.branch, task.result.branch);
    assert.ok(store.audit(id, 'acme').some(event => event.type === 'proposal.approved' && event.actor === 'lead'));
  } finally { reopened.close(); }
});

test('duplicate intake is idempotent, conflicting IDs rejected, equal reports with different IDs retained', async t => {
  const { engine, id } = await setup(t);
  assert.equal(engine.submit(feedback).task.id, id);
  assert.equal(engine.pendingJobs().length, 1);
  assert.throws(() => engine.submit({ ...feedback, text: 'Different content' }), /different content/);
  assert.notEqual(engine.submit({ ...feedback, externalId: 'ticket-2' }).task.id, id);
  assert.throws(() => engine.submit({ ...feedback, organizationId: 'other' }));
  assert.throws(() => engine.submit({ ...feedback, text: '' }));
});

test('organization boundaries and explicit approver permissions are enforced', async t => {
  const { engine, store, id } = await setup(t);
  await engine.drain();
  assert.throws(() => store.get(id, 'other'), /not found/);
  assert.throws(() => engine.comment(id, { ...lead, organizationId: 'other' }, 'hi'), /another organization/);
  assert.throws(() => engine.approve(id, engineer, 1), /not an authorized/);
  assert.throws(() => engine.approve(id, lead, 2), /Outdated/);
  assert.equal(engine.pendingJobs().length, 0);
});

test('version changes invalidate old approvals and duplicate approvals cannot enqueue twice', async t => {
  const { engine, id } = await setup(t);
  await engine.drain();
  engine.revise(id, engineer, 1);
  assert.throws(() => engine.approve(id, lead, 1), /revising/);
  await engine.drain();
  assert.throws(() => engine.approve(id, lead, 1), /Outdated/);
  engine.approve(id, lead, 2);
  engine.approve(id, lead, 2);
  assert.equal(engine.pendingJobs().length, 1);
  assert.throws(() => engine.comment(id, engineer, 'Change more things'), /approved/);
});

test('expired proposals and delayed approved jobs require fresh review', async t => {
  let now = new Date('2026-09-12T12:00:00Z');
  const { engine, id } = await setup(t, new DemoProvider(), () => now);
  await engine.drain();
  now = new Date('2026-09-14T12:00:00Z');
  assert.throws(() => engine.approve(id, lead, 1), /expired/);
  engine.revise(id, engineer, 1); await engine.drain();
  engine.approve(id, lead, 2);
  now = new Date('2026-09-16T12:00:00Z');
  await engine.drain();
  assert.equal(engine.get(id).status, 'failed');
  assert.match(engine.get(id).error!, /expired/);
  assert.equal(engine.get(id).result, undefined);
});

test('changed repository base blocks implementation of an approved proposal', async t => {
  const { engine, repo, id } = await setup(t);
  await engine.drain(); engine.approve(id, lead, 1);
  await command(repo.path, 'git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test',
    '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-m', 'Base advanced']);
  await engine.drain();
  assert.equal(engine.get(id).status, 'failed');
  assert.match(engine.get(id).error!, /base changed/);
  assert.equal(engine.get(id).result, undefined);
});

test('failing regression tests never produce a ready result and preserve diagnostics', async t => {
  class BrokenProvider extends DemoProvider {
    override async implement(task: Parameters<DemoProvider['implement']>[0], workspace: string) {
      await super.implement(task, workspace);
      await writeFile(join(workspace, 'failure.test.mjs'), "import test from 'node:test'; test('regression', () => { throw Error('broken'); });");
    }
  }
  const { engine, root, id } = await setup(t, new BrokenProvider());
  await engine.drain(); engine.approve(id, lead, 1); await engine.drain();
  assert.equal(engine.get(id).status, 'failed');
  assert.equal(engine.get(id).result, undefined);
  assert.match(await readFile(join(root, 'artifacts', id, 'tests.txt'), 'utf8'), /broken/);
  assert.equal(engine.pendingJobs().length, 0);
});

test('concurrent deliveries execute the coding provider once', async t => {
  let implementations = 0;
  class CountedProvider extends DemoProvider {
    override async implement(task: Parameters<DemoProvider['implement']>[0], workspace: string) {
      implementations++; await super.implement(task, workspace);
    }
  }
  const { engine, id } = await setup(t, new CountedProvider());
  await engine.drain(); engine.approve(id, lead, 1);
  const jobId = engine.pendingJobs()[0]!.id;
  await Promise.all([engine.runJob(jobId), engine.runJob(jobId)]);
  assert.equal(implementations, 1);
  assert.equal(engine.get(id).status, 'changes_ready');
});

test('comment receipt and discussion commit atomically and redeliveries are no-ops', async t => {
  const { engine, store, id } = await setup(t);
  assert.throws(() => engine.comment(id, engineer, 'keep headers', 'msg-1'), /received/);
  assert.equal(store.hasReceipt('msg-1'), false);
  await engine.drain();
  engine.comment(id, engineer, 'keep headers', 'msg-1');
  engine.comment(id, engineer, 'keep headers', 'msg-1');
  assert.equal(engine.get(id).comments.length, 1);
  assert.equal(store.hasReceipt('msg-1'), true);
});

test('unactionable feedback cannot be approved for code execution', async t => {
  class NonCodeProvider extends DemoProvider {
    override async investigate(task: Parameters<DemoProvider['investigate']>[0], workspace: string) {
      return { ...await super.investigate(task, workspace), disposition: 'non_code' as const };
    }
  }
  const { engine, id } = await setup(t, new NonCodeProvider());
  await engine.drain();
  assert.throws(() => engine.approve(id, lead, 1), /not an actionable/);
  engine.decline(id, engineer);
  assert.equal(engine.get(id).status, 'declined');
  assert.equal(engine.pendingJobs().length, 0);
});

test('a stopped worker is recovered without rerunning an uncertain operation', async t => {
  const { engine, store, id, dbPath } = await setup(t);
  const jobId = engine.pendingJobs()[0]!.id;
  const script = `import { Store } from ${JSON.stringify(resolve('src/store.ts'))};
const store = new Store(${JSON.stringify(dbPath)});
store.claimJob(${JSON.stringify(jobId)}, 'acme'); store.close();`;
  await command(process.cwd(), process.execPath, ['--import=tsx', '--input-type=module', '-e', script]);
  assert.equal(store.jobs('acme')[0]!.status, 'running');
  assert.match(store.recoverInterrupted('acme'), /Recovered 1/);
  assert.equal(engine.get(id).status, 'failed');
  assert.equal(engine.pendingJobs().length, 0);
  engine.revise(id, lead, 0); await engine.drain();
  assert.equal(engine.get(id).status, 'discussing');
});

test('a pending job remains executable after restarting the application', async t => {
  const { engine, store, repo, root, dbPath, id } = await setup(t);
  const anotherStore = new Store(dbPath);
  try {
    const anotherEngine = new Engine(anotherStore, 'acme', repo, new DemoProvider(), root);
    await anotherEngine.drain();
    assert.equal(engine.get(id).status, 'discussing');
    assert.equal(store.jobs('acme')[0]!.status, 'done');
  } finally { anotherStore.close(); }
});
