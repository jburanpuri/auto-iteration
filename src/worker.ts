import 'dotenv/config';
import { createServer } from 'node:http';
import { Inngest } from 'inngest';
import { serve } from 'inngest/node';
import { runtime } from './runtime.js';

async function main() {
  if (process.env.INNGEST_DEV !== '1' && (!process.env.INNGEST_SIGNING_KEY || !process.env.INNGEST_EVENT_KEY)) {
    throw new Error('Use INNGEST_DEV=1 locally, or configure Inngest event/signing keys.');
  }
  const { engine } = runtime();
  const inngest = new Inngest({ id: 'auto-iteration', isDev: process.env.INNGEST_DEV === '1' });
  const execute = inngest.createFunction({ id: 'execute-feedback-job',
    triggers: { event: 'feedback/job.requested' }, concurrency: { limit: 1 } },
  async ({ event, step }) => {
    if (event.data.organizationId !== engine.organizationId || typeof event.data.jobId !== 'string') {
      return { skipped: 'Unknown organization or invalid job.' };
    }
    return step.run('execute-persisted-job', async () => {
      const result = await engine.runJob(event.data.jobId);
      return result ? { taskId: result.id, status: result.status } : { skipped: 'Job already claimed or finished.' };
    });
  });
  const handler = serve({ client: inngest, functions: [execute] });
  const server = createServer((req, res) => {
    if (req.url?.split('?')[0] === '/api/inngest') return handler(req, res);
    if (req.url === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"status":"ok"}'); return; }
    res.writeHead(404); res.end('Not found');
  });
  const port = Number(process.env.WORKER_PORT || '3000');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid WORKER_PORT.');
  server.listen(port, '127.0.0.1', () => console.log(`Inngest adapter: http://127.0.0.1:${port}/api/inngest`));
  // Durable outbox: approval and its pending job are committed together in SQLite.
  // Repeated send attempts reuse the same event ID; execution also claims jobs atomically.
  let dispatching = false;
  const timer = setInterval(async () => {
    if (dispatching) return;
    dispatching = true;
    try {
      for (const job of engine.pendingJobs()) {
        await inngest.send({ id: job.id, name: 'feedback/job.requested',
          data: { jobId: job.id, organizationId: engine.organizationId } });
      }
    } catch (error) { console.error('Inngest dispatch failed; queued jobs remain stored.', error instanceof Error ? error.message : error); }
    finally { dispatching = false; }
  }, 5000);
  const stop = () => { clearInterval(timer); server.close(); process.exit(0); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
