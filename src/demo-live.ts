import { config } from 'dotenv';
import { cloudBridge } from './cloud-bridge.js';
import { publishApproved } from './publish.js';
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { prepareProductDemo } from './demo-runtime.js';
import { runtime } from './runtime.js';
import { feedbackServer } from './feedback-api.js';
import { discordSettings, startDiscord } from './discord.js';

async function main() {
  if(process.env.HOSTED_DEMO === '1')config({path:'hosted/.env.local'});
  const useDiscord = !!process.env.DISCORD_BOT_TOKEN;
  if (useDiscord) discordSettings();
  const port = Number(process.env.FEEDBACK_PORT || 4318);
  const operatorPort = Number(process.env.DEMO_OPERATOR_PORT || port + 1);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FEEDBACK_PORT.');
  if (!Number.isInteger(operatorPort) || operatorPort < 1 || operatorPort > 65535 || operatorPort === port) throw new Error('Invalid DEMO_OPERATOR_PORT.');
  const root = await prepareProductDemo();
  const tokenPath = resolve(root, 'feedback-api-token');
  try { await writeFile(tokenPath, randomBytes(32).toString('hex'), { flag: 'wx', mode: 0o600 }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
  const { store, engine } = runtime();
  if(process.env.AUTO_PUBLISH === '1')engine.publish = task => publishApproved(engine.repo, task, root);
  let discordStop: (() => Promise<void>) | undefined;
  const server = feedbackServer(engine, (await readFile(tokenPath, 'utf8')).trim(), {
    productUI: true, guidedDemo: true, collectOnly: true, discordConnected: () => !!discordStop, operatorUrl: `http://127.0.0.1:${operatorPort}`,
  });
  const operator = feedbackServer(engine, randomBytes(32).toString('hex'), {
    productUI: true, guidedDemo: true, operatorUI: true, productUrl: `http://127.0.0.1:${port}`,
    discordConnected: () => !!discordStop,
  });
  try {
    server.listen(port, '127.0.0.1');
    await once(server, 'listening');
    operator.listen(operatorPort, '127.0.0.1'); await once(operator, 'listening');
    if (useDiscord) discordStop = await startDiscord(engine, false);
  } catch (error) { server.close(); operator.close(); store.close(); throw error; }
  const syncCloud = process.env.HOSTED_DEMO === '1' ? cloudBridge(engine, () => !!discordStop) : undefined;
  const cloudTimer = syncCloud ? setInterval(() => { void syncCloud().catch(error=>console.error('Cloud inbox:',error.message)); }, 15000) : undefined;
  if(syncCloud)await syncCloud();
  let active: Promise<void> | undefined;
  let stopping = false;
  const timer = setInterval(() => {
    if (stopping || active || process.env.JOB_RUNNER === 'inngest') return;
    active = engine.drain().catch(error => console.error('Demo worker failed:', error.message)).finally(() => { active = undefined; });
  }, 1000);
  const stop = async () => {
    if (stopping) return; stopping = true; clearInterval(timer); clearInterval(cloudTimer);
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => operator.close(() => resolve()));
    await active; await discordStop?.(); store.close();
  };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
  console.log(`Northstar feedback: http://127.0.0.1:${port}/`);
  console.log(`Reviews and workflow: http://127.0.0.1:${operatorPort}/`);
  console.log(engine.provider.label);
  console.log(engine.conversation?.label ?? 'Conversation uses the configured engineering provider.');
  console.log(useDiscord ? 'Feedback routes to the configured Discord team channels after investigation.' : 'Discord is not configured. Use the product now; add Discord settings in .env to connect your team.');
  console.log('Local operator commands: npm run demo:cli -- list (or show/comment/revise/approve TASK_ID).');
  console.log(`Product repository: ${engine.repo.path}`);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
