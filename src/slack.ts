import 'dotenv/config';
import bolt from '@slack/bolt';
import { runtime } from './runtime.js';
import { formatTask } from './format.js';
import { parseSlackCommand, escapeSlack } from './slack-commands.js';
import type { Task } from './domain.js';

async function main() {
  const required = ['SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'SLACK_TEAM_ID', 'SLACK_CHANNEL_ID', 'SLACK_APPROVER_IDS'];
  for (const key of required) if (!process.env[key]?.trim()) throw new Error(`Set ${key} before starting Slack.`);
  const { store, engine } = runtime();
  const channel = process.env.SLACK_CHANNEL_ID!;
  const team = process.env.SLACK_TEAM_ID!;
  const approvers = new Set(process.env.SLACK_APPROVER_IDS!.split(',').map(id => id.trim()).filter(Boolean));
  const app = new bolt.App({ token: process.env.SLACK_BOT_TOKEN, appToken: process.env.SLACK_APP_TOKEN, socketMode: true });
  const help = `Use @bot feedback <customer report> in this channel to start an investigation.
Discuss in the task's thread. Then use @bot revise <version> to incorporate the discussion,
@bot approve <version> to approve, @bot decline, or @bot status.
${engine.provider.label}`;
  async function post(text: string, thread?: string) {
    return app.client.chat.postMessage({ channel, thread_ts: thread, text: escapeSlack(text).slice(0, 30_000),
      mrkdwn: false, unfurl_links: false, unfurl_media: false });
  }
  function taskInThread(thread?: string) {
    const task = store.list(engine.organizationId).find(task => task.slackThread === thread);
    if (!task) throw new Error('Reply in an existing feedback task thread.');
    return task;
  }
  app.event('app_mention', async ({ event, body }) => {
    if (body.team_id !== team || event.channel !== channel || !event.user || 'bot_id' in event) return;
    const thread = event.thread_ts ?? event.ts;
    try {
      const command = parseSlackCommand(event.text);
      if (command.kind === 'help') { await post(help, thread); return; }
      if (command.kind === 'feedback') {
        if (event.thread_ts) throw new Error('Start new feedback as a top-level channel message.');
        const { task, duplicate } = engine.submit({ source: `slack:${team}:${channel}`, externalId: event.ts,
          title: command.text.slice(0, 180), text: command.text });
        engine.attachSlack(task.id, thread);
        if (!duplicate) await post(`Feedback accepted. Investigation queued.\n${engine.provider.label}\nTask: ${task.id}`, thread);
        return;
      }
      const task = taskInThread(event.thread_ts);
      const actor = { id: event.user, organizationId: engine.organizationId, canApprove: approvers.has(event.user) };
      if (command.kind === 'approve') engine.approve(task.id, actor, command.version);
      if (command.kind === 'revise') engine.revise(task.id, actor, command.version);
      if (command.kind === 'decline') engine.decline(task.id, actor);
      await post(formatTask(engine.get(task.id)), thread);
    } catch (error) { await post(error instanceof Error ? error.message : 'Could not process command.', thread); }
  });
  app.message(async ({ message, body, context }) => {
    const msg = message as { channel: string; text?: string; user?: string; bot_id?: string; subtype?: string; thread_ts?: string; ts: string };
    if (body.team_id !== team || msg.channel !== channel || !msg.text || !msg.user || msg.bot_id ||
      msg.subtype || !msg.thread_ts || msg.text.includes(`<@${context.botUserId}>`)) return;
    try {
      const task = taskInThread(msg.thread_ts);
      // Slack redeliveries have stable message timestamps.
      const eventId = `slack-comment:${team}:${channel}:${msg.ts}`;
      if (store.hasReceipt(eventId)) return;
      engine.comment(task.id, { id: msg.user, organizationId: engine.organizationId, canApprove: false }, msg.text, eventId);
    } catch (error) { await post(error instanceof Error ? error.message : 'Comment could not be recorded.', msg.thread_ts); }
  });
  async function notify(task: Task) {
    if (!task.slackThread || !['discussing', 'changes_ready', 'failed', 'declined'].includes(task.status)) return;
    const signature = `slack-state:${task.id}:${task.status}:${task.plans.at(-1)?.version ?? 0}:${task.error ?? ''}`;
    if (store.hasReceipt(signature)) return;
    await post(formatTask(task), task.slackThread);
    store.recordReceipt(signature);
  }
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (process.env.JOB_RUNNER !== 'inngest') await engine.drain();
      for (const task of store.list(engine.organizationId)) await notify(task);
    } catch (error) { console.error('Slack worker tick failed:', error instanceof Error ? error.message : error); }
    finally { busy = false; }
  };
  await app.start();
  console.log(`Slack connected to configured workspace/channel. ${engine.provider.label}`);
  const timer = setInterval(() => { void tick(); }, 2000);
  const stop = async () => { clearInterval(timer); await app.stop(); process.exit(0); };
  process.once('SIGINT', () => { void stop(); });
  process.once('SIGTERM', () => { void stop(); });
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
