import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runtime } from './runtime.js';
import { seedRepository } from './seed.js';
import { formatTask } from './format.js';
import { braveSearch } from './research.js';

const help = `Auto Iteration — local engineering workflow

npm run cli -- init
npm run cli -- submit examples/feedback.json
npm run cli -- run
npm run cli -- list
npm run cli -- show TASK_ID
npm run cli -- comment TASK_ID "Keep the column headers when there are no rows."
npm run cli -- revise TASK_ID PLAN_VERSION
npm run cli -- approve TASK_ID PLAN_VERSION
npm run cli -- decline TASK_ID
npm run cli -- research TASK_ID "public technical query"
npm run cli -- recover

After submit/revise/approve, run 'run' to execute queued jobs, or use the Inngest worker.
CLI commands trust the local machine owner. Slack uses a separate configured approver list.
`;

async function main() {
  const [action, id, ...rest] = process.argv.slice(2);
  if (!action || action === 'help') { console.log(help); return; }
  if (action === 'init') {
    const repo = await seedRepository(resolve(process.env.DATA_DIR || '.local'));
    console.log(`Created the deliberately broken demo repository: ${repo.path}`); return;
  }
  const { store, engine } = runtime();
  const actor = { id: 'local-engineer', organizationId: engine.organizationId, canApprove: true };
  const requiredId = () => { if (!id) throw new Error('TASK_ID is required.'); return id; };
  const version = () => {
    const v = Number(rest[0]);
    if (!rest[0] || !Number.isInteger(v) || v < 0) throw new Error('An explicit numeric PLAN_VERSION is required.');
    return v;
  };
  try {
    switch (action) {
      case 'submit': {
        const result = engine.submit(JSON.parse(await readFile(requiredId(), 'utf8')));
        console.log(result.duplicate ? 'Duplicate delivery: existing task returned.' : 'Feedback accepted; investigation queued.');
        console.log(formatTask(result.task)); break;
      }
      case 'run': await engine.drain(); console.log('Pending jobs processed. Use list/show to inspect results.'); break;
      case 'list': for (const task of store.list(engine.organizationId)) console.log(`${task.id}  ${task.status}  ${task.feedback.title}`); break;
      case 'show': console.log(formatTask(engine.get(requiredId()))); console.log(JSON.stringify(store.audit(id!, engine.organizationId), null, 2)); break;
      case 'comment': console.log(formatTask(engine.comment(requiredId(), actor, rest.join(' ')))); break;
      case 'revise': console.log(formatTask(engine.revise(requiredId(), actor, version()))); break;
      case 'approve': console.log(formatTask(engine.approve(requiredId(), actor, version()))); break;
      case 'decline': console.log(formatTask(engine.decline(requiredId(), actor))); break;
      case 'research': {
        engine.get(requiredId());
        const results = await braveSearch(rest.join(' '), process.env.BRAVE_SEARCH_API_KEY || '');
        if (!results.length) { console.log('No usable sources found; task unchanged.'); break; }
        console.log(formatTask(engine.comment(id!, actor, `External search snippets; claims are unverified until checked against source pages:\n${results.map(r => `${r.title}\n${r.url}\n${r.description}`).join('\n\n')}`)));
        break;
      }
      case 'recover': console.log(store.recoverInterrupted(engine.organizationId)); break;
      default: throw new Error(help);
    }
  } finally { store.close(); }
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
