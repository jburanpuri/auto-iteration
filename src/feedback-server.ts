import 'dotenv/config';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { runtime } from './runtime.js';
import { seedRepository } from './seed.js';
import { feedbackServer } from './feedback-api.js';

async function main() {
  if (process.env.EXECUTOR && process.env.EXECUTOR !== 'demo') throw new Error('The feedback demo server requires EXECUTOR=demo.');
  const port = Number(process.env.FEEDBACK_PORT || '4318');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FEEDBACK_PORT.');
  const root = resolve(process.env.DATA_DIR || '.local');
  await mkdir(root, { recursive: true });
  try { await access(resolve(root, 'customer-demo')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await seedRepository(root);
  }
  const tokenPath = resolve(root, 'feedback-api-token');
  try { await writeFile(tokenPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const { store, engine } = runtime();
  const server = feedbackServer(engine, (await readFile(tokenPath, 'utf8')).trim());
  let active: Promise<void> | undefined;
  let stopping = false;
  const tick = () => {
    if (active || stopping || process.env.JOB_RUNNER === 'inngest') return;
    active = engine.drain().catch(error => console.error('Demo worker failed:', error)).finally(() => { active = undefined; });
  };
  const timer = setInterval(tick, 500);
  const stop = async () => {
    if (stopping) return;
    stopping = true; clearInterval(timer);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await active; store.close();
  };
  server.once('error', error => { console.error(error.message); clearInterval(timer); store.close(); process.exitCode = 1; });
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  server.listen(port, '127.0.0.1', () => {
    console.log(`Demo CRM feedback API: http://127.0.0.1:${port}/api/feedback`);
    console.log('Submit a report: npm run feedback:send -- examples/feedback-api.json');
    console.log('Scripted CSV-export fixture. Discussion and approval remain in the CLI or Slack.');
    console.log(`Local intake token stored at ${tokenPath}; the sender reads it automatically.`);
  });
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
