import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import assert from 'node:assert/strict';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { DemoProvider } from './providers.js';
import { seedRepository } from './seed.js';
import { command } from './git.js';
import { formatTask } from './format.js';

async function demo() {
  await mkdir(resolve('.local', 'runs'), { recursive: true });
  const root = await mkdtemp(resolve('.local', 'runs', 'demo-'));
  const repo = await seedRepository(root);
  const store = new Store(join(root, 'state.sqlite'));
  const engine = new Engine(store, 'demo-company', repo, new DemoProvider(), root);
  const engineer = { id: 'engineer-ada', organizationId: engine.organizationId, canApprove: false };
  const approver = { id: 'engineering-lead', organizationId: engine.organizationId, canApprove: true };
  const transcript: string[] = [];
  const log = (message: string) => { transcript.push(message); console.log(message); };
  try {
    log('SCRIPTED DEMO: two sample engineers; real Git checkouts, code edits, and tests. No API calls.');
    // Prove the reported bug exists independently of the provider's explanation.
    await assert.rejects(command(repo.path, process.execPath, ['--input-type=module', '-e',
      "import { exportCsv } from './export.mjs'; exportCsv([]);"]));
    log('1. Reproduced the empty-export crash in the original demo repository.');
    const feedback = { source: 'manual-demo', externalId: 'review-001', title: 'CSV export crashes with no results',
      text: 'After filtering out all customers, clicking Export CSV crashes instead of downloading a file.' };
    const { task } = engine.submit(feedback);
    assert.equal(engine.submit(feedback).task.id, task.id);
    log(`2. Feedback accepted; duplicate delivery reused task ${task.id}.`);
    await engine.drain();
    assert.equal(engine.get(task.id).status, 'discussing');
    log('3. Proposed v1: return an empty string for an empty export.');
    engine.comment(task.id, engineer, 'Keep the column headers so our business users can use the file as a template.');
    assert.throws(() => engine.approve(task.id, approver, 1), /New discussion/);
    engine.revise(task.id, engineer, 1);
    await engine.drain();
    log('4. Engineer discussion produced v2: preserve column headers.');
    assert.throws(() => engine.approve(task.id, approver, 1), /Outdated/);
    assert.throws(() => engine.approve(task.id, engineer, 2), /not an authorized/);
    engine.approve(task.id, approver, 2);
    engine.approve(task.id, approver, 2);
    log('5. Lead approved v2. Stale, unauthorized, and duplicate approvals were handled.');
    await engine.drain();
    const completed = engine.get(task.id);
    assert.equal(completed.status, 'changes_ready', completed.error);
    assert.equal((await command(repo.path, 'git', ['status', '--porcelain'])).trim(), '');
    log(`6. Implementation and repository tests passed. Original repository remains clean.\n\n${formatTask(completed)}`);
    await writeFile(resolve('.local', 'last-demo.md'), `# Latest working demo\n\n${transcript.join('\n\n')}\n`);
  } finally { store.close(); }
}
demo().catch(error => { console.error(error); process.exitCode = 1; });
