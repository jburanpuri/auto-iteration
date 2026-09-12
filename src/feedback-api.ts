import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { Engine } from './engine.js';
import { DomainError, TaskNotFoundError, inputSchema, issueSchema, logSchema, type Task } from './domain.js';
import { CodexProvider } from './providers.js';
import { serveProduct } from './product-preview.js';
import { feedbackBatchScenarios, datedFeedbackScenarios } from './demo-feedback.js';

const bodySchema = inputSchema.omit({ source: true }).strict();
const maxBytes = 64 * 1024;
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req: IncomingMessage, timeoutMs: number): Promise<unknown> {
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? '')) {
    throw new HttpError(415, 'Send application/json.');
  }
  if (Number(req.headers['content-length']) > maxBytes) {
    req.resume();
    throw new HttpError(413, 'Request body exceeds 64 KiB.');
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const cleanup = () => {
      clearTimeout(timer);
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      req.off('aborted', onAborted);
      chunks.length = 0;
    };
    const onError = (error: Error) => { cleanup(); reject(error); };
    const onAborted = () => onError(new HttpError(400, 'Request aborted.'));
    const onData = (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        onError(new HttpError(413, 'Request body exceeds 64 KiB.'));
      } else chunks.push(chunk);
    };
    const onEnd = () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON.')); }
      finally { cleanup(); }
    };
    // A fixed deadline also bounds clients that keep trickling body bytes.
    const timer = setTimeout(() => onError(new HttpError(408, 'Request body timed out.')), timeoutMs);
    timer.unref();
    req.on('data', onData);
    req.once('end', onEnd);
    req.once('error', onError);
    req.once('aborted', onAborted);
  });
}

/** Operator controls are opt-in and hosted on a separate loopback origin by demo-live. */
export function feedbackServer(engine: Engine, token: string, options: { productUI?: boolean; discordConnected?: () => boolean;
  guidedDemo?: boolean; operatorUI?: boolean; operatorUrl?: string; productUrl?: string; bodyTimeoutMs?: number; collectOnly?: boolean; reset?: (id:string)=>Promise<unknown> } = {}) {
  if (token.length < 24) throw new Error('The feedback API token must contain at least 24 characters.');
  const bodyTimeoutMs = options.bodyTimeoutMs ?? 10_000;
  if (!Number.isSafeInteger(bodyTimeoutMs) || bodyTimeoutMs <= 0) throw new Error('Body timeout must be a positive integer.');
  const expected = Buffer.from(`Bearer ${token}`);
  const mode = engine.provider instanceof CodexProvider ? 'codex' : 'scripted-demo';
  const conversations = new Set<string>();
  const cookieName = options.operatorUI ? 'northstar_operator' : 'orbit_demo';
  const taskView = (task: Task) => ({ taskId: task.id, product: 'Demo CRM', mode, status: task.status,
    publication: task.publication, batchId: task.batchId, createdAt: task.createdAt, feedback: task.feedback, plan: task.plans.at(-1) ?? null, comments: task.comments,
    discord: task.discord ?? null, signal: task.signal ?? null, approval: task.approval ?? null, result: task.result ?? null, error: task.error ?? null,
    agentNotes: task.agentNotes ?? [], audit: engine.store.audit(task.id, engine.organizationId), conversationPending: conversations.has(task.id) });
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (options.productUI) {
        // The local browser receives a session cookie, never the intake secret in JavaScript.
        if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(req.headers.host || '')) throw new HttpError(403, 'Open the demo on localhost.');
        if (options.operatorUI && req.headers.host?.split(':')[1] !== String(req.socket.localPort)) throw new HttpError(403, 'Invalid operator origin.');
        if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Cross-origin requests are not accepted.');
        if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not accepted.');
        if (req.method === 'GET' && (['/', '/reviews/', '/feedback/', '/product/'].includes(path) || (options.operatorUI && path === '/engineering/') || /^\/preview\/[a-f0-9-]{36}\/$/.test(path))) {
          res.setHeader('Set-Cookie', `${cookieName}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/`);
        }
        if (req.method === 'GET' && !path.startsWith('/api/') && path !== '/health') {
          const engineeringPage = options.operatorUI && path.startsWith('/engineering/');
          const assetPath = engineeringPage ? path.slice('/engineering'.length) : options.operatorUI && path.startsWith('/reviews/') ? path.slice('/reviews'.length) : !options.operatorUI && path.startsWith('/feedback/') ? (path.slice('/feedback'.length) || '/') : !options.operatorUI && path.startsWith('/product/') ? (path === '/product/' ? '/product.html' : path.slice('/product'.length)) : path;
          const trustedRoot = options.operatorUI ? fileURLToPath(new URL(engineeringPage ? '../examples/mini-crm/' : '../examples/reviews/', import.meta.url)) : undefined;
          if (await serveProduct(engine, assetPath, res, trustedRoot)) return;
          throw new HttpError(404, 'Product file or ready preview not found.');
        }
      }
      if (req.method === 'GET' && path === '/health') {
        json(res, 200, { status: 'ok', product: 'Demo CRM', mode }); return;
      }
      const cookie = options.productUI ? req.headers.cookie?.split(';').map(item => item.trim())
        .find(item => item.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) : undefined;
      const actual = Buffer.from(req.headers.authorization || (cookie ? `Bearer ${decodeURIComponent(cookie)}` : ''));
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        req.resume(); throw new HttpError(401, 'A valid intake bearer token is required.');
      }
      if (req.method === 'GET' && path === '/api/tasks' && options.productUI) {
        json(res, 200, { reset:engine.resetState, mode, discord: options.discordConnected?.() ?? false, operator: options.operatorUI ?? false,
          operatorUrl: options.operatorUrl, productUrl: options.productUrl, demoScenarios: options.operatorUI ? datedFeedbackScenarios() : undefined, guidedDemo: options.guidedDemo ?? false,
          batches: engine.store.batches(engine.organizationId, engine.repo.id), reviews: engine.store.reviews(engine.organizationId, engine.repo.id),
          complaints: engine.store.complaintCounts(engine.organizationId, engine.repo.id, new Date(Date.now() - 30 * 60_000).toISOString()),
          tasks: engine.store.list(engine.organizationId).filter(task => task.repositoryId === engine.repo.id).map(taskView) }); return;
      }
      if(req.method==='POST' && path==='/api/workflow/reset' && options.operatorUI && options.reset) {
        if(req.headers.origin!==`http://${req.headers.host}`)throw new HttpError(403,'Same-origin request required.');
        const {resetId}=z.object({resetId:z.string().uuid()}).strict().parse(await readJson(req,bodyTimeoutMs));
        if(engine.maintenance)throw new DomainError('Demo reset is already running.');
        void options.reset(resetId).catch(error=>console.error('Demo reset:',error.message));
        json(res,202,{status:'pending',id:resetId});return;
      }
      if (req.method === 'POST' && path === '/api/workflow/start' && options.operatorUI) {
        if (req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Same-origin request required.');
        const { batchId } = z.object({ batchId: z.string().uuid() }).strict().parse(await readJson(req, bodyTimeoutMs));
        for (const [group, scenario] of feedbackBatchScenarios.entries()) for (const [index, review] of scenario.reviews.entries()) {
          engine.collect({ source: 'demo-samples', externalId: `sample-${group}-${index}`, title: scenario.title,
            text: `Reported by ${review.name} (sample participant).\n${review.text}`, category: scenario.category }, true);
        }
        const batch = engine.store.queueBatch(engine.organizationId, engine.repo.id, batchId);
        json(res, 202, batch); return;
      }
      const action = /^\/api\/operator\/([a-f0-9-]{36})\/(comment|revise|approve|decline)$/.exec(path);
      if (req.method === 'POST' && path === '/api/operator/demo-batch' && options.operatorUI) {
        if (req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Demo batches require the engineer console origin.');
        const { batchId } = z.object({ batchId: z.string().uuid() }).strict().parse(await readJson(req, bodyTimeoutMs));
        const scenarios = feedbackBatchScenarios;
        const taskIds = new Set<string>();
        for (const [index, scenario] of scenarios.entries()) for (const [person, review] of scenario.reviews.entries()) {
          const result = engine.demoReview({ source: `demo-batch:${batchId}`, externalId: `${batchId}:${index}:${person}`,
            category: scenario.category, title: `[Demo feedback] ${scenario.title}`,
            text: `Reported by ${review.name} (sample participant).\n${review.text}` }, 'other', true, true, `scenario-${index}`);
          if (result.review.taskId) taskIds.add(result.review.taskId);
        }
        json(res, 202, { batchId, feedbackCount: scenarios.reduce((count, scenario) => count + scenario.reviews.length, 0), taskIds: [...taskIds], mode,
          message: mode === 'codex' ? '120 sample reviews grouped into three investigations. Each proposal routes to its selected team.'
            : 'Scripted rehearsal: 120 entries queued. Only the CSV fixture can be implemented in this mode; use live Codex for all three scenarios.' }); return;
      }
      if (req.method === 'POST' && action && options.operatorUI) {
        if (req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, 'Operator actions require the engineer console origin.');
        const id = action[1]!;
        const current = engine.get(id);
        if (current.repositoryId !== engine.repo.id) throw new HttpError(404, 'Task not found.');
        if (conversations.has(id)) throw new DomainError('Wait for the conversation reply before changing this plan.');
        const actor = { id: 'local-demo-engineer', organizationId: engine.organizationId, canApprove: true };
        const body = await readJson(req, bodyTimeoutMs);
        if (action[2] === 'comment') {
          const { text, receiptId } = z.object({ text: z.string().trim().min(1).max(8000), receiptId: z.string().uuid() }).strict().parse(body);
          const receipt = `web-comment:${id}:${receiptId}`;
          if (engine.store.hasReceipt(receipt)) { json(res, 200, taskView(engine.get(id))); return; }
          const task = engine.comment(id, actor, text, receipt);
          conversations.add(id);
          try { await engine.answer(task); }
          catch (error) {
            json(res, 200, { ...taskView(engine.get(id)), warning: `Comment saved. Conversation failed: ${error instanceof Error ? error.message : 'Unknown error'}` }); return;
          } finally { conversations.delete(id); }
        } else if (action[2] === 'decline') {
          z.object({}).strict().parse(body); engine.decline(id, actor);
        } else {
          const { version } = z.object({ version: z.number().int().nonnegative() }).strict().parse(body);
          if (action[2] === 'revise') engine.revise(id, actor, version);
          else engine.approve(id, actor, version);
        }
        json(res, 200, taskView(engine.get(id))); return;
      }
      if (req.method === 'POST' && path === '/api/demo/samples' && options.guidedDemo && options.productUI) {
        const samples = [
          { issue: 'csv_export' as const, title: 'Empty export fails', text: 'Archived contacts is empty. Export CSV shows an error.' },
          { issue: 'csv_export' as const, title: 'Cannot export an empty contact list', text: 'I filtered to Archived and the CSV export crashed.' },
          { issue: 'other' as const, title: 'Add a dark theme', text: 'I would like a dark theme for working in the evening.' },
          { issue: 'other' as const, title: 'Guaranteed crypto profit', text: 'Click here for crypto offers and guaranteed income!' },
        ];
        samples.forEach((sample, index) => engine.demoReview({ externalId: `walkthrough-sample-${index}`, source: 'demo-http', title: sample.title, text: sample.text }, sample.issue, true));
        json(res, 200, { accepted: true }); return;
      }
      if (req.method === 'POST' && path === '/api/events' && options.productUI) {
        const event = logSchema.parse(await readJson(req, bodyTimeoutMs));
        engine.store.recordLog(engine.organizationId, engine.repo.id, { ...event, at: new Date().toISOString() });
        json(res, 202, { accepted: true }); return;
      }
      const artifact = /^\/api\/tasks\/([a-f0-9-]{36})\/(patch|tests|review)$/.exec(path);
      if (req.method === 'GET' && artifact && options.productUI) {
        const task = engine.get(artifact[1]!);
        if (task.repositoryId !== engine.repo.id || task.status !== 'changes_ready' || !task.result) throw new HttpError(404, 'No ready artifacts.');
        const file = { patch: task.result.patchPath, tests: task.result.testOutputPath, review: task.result.summaryPath }[artifact[2]!];
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.end(await readFile(file!, 'utf8')); return;
      }
      if (req.method === 'POST' && path === '/api/feedback') {
        const body = await readJson(req, bodyTimeoutMs);
        if (options.productUI) {
          const parsed = bodySchema.extend({ issue: issueSchema.optional(), reviewer: z.string().trim().min(1).max(80).optional() }).strict().parse(body);
          const { issue, reviewer, ...feedback } = parsed;
          if (options.guidedDemo) {
            const intake = { ...feedback, title: `${reviewer ?? 'A user'}: ${feedback.title}`.slice(0, 200),
              text: `Reported by ${reviewer ?? 'a user'} (self-reported name).\n${feedback.text}`.slice(0, 12000), source: 'demo-http' };
            const result = options.collectOnly ? engine.collect(intake) : engine.demoReview(intake, issue ?? 'other');
            json(res, result.duplicate ? 200 : 202, { ...result, taskId: result.review.taskId ?? null,
              status: result.review.disposition, reason: result.review.reason }); return;
          }
          if (issue) {
            const result = engine.report({ ...feedback, source: 'demo-http' }, issue);
            json(res, result.duplicate ? 200 : 202, { taskId: result.task?.id ?? null, status: result.task?.status ?? 'collecting',
              duplicate: result.duplicate, reportCount: result.reportCount, threshold: issue === 'other' ? 1 : 3 }); return;
          }
          const result = engine.submit({ ...feedback, source: 'demo-http' });
          json(res, result.duplicate ? 200 : 202, { taskId: result.task.id, status: result.task.status, duplicate: result.duplicate });
          return;
        }
        const feedback = bodySchema.parse(body);
        const result = engine.submit({ ...feedback, source: 'demo-http' });
        res.setHeader('Location', `/api/tasks/${result.task.id}`);
        json(res, result.duplicate ? 200 : 202, { taskId: result.task.id, status: result.task.status,
          duplicate: result.duplicate, product: 'Demo CRM', statusUrl: `/api/tasks/${result.task.id}` });
        return;
      }
      const match = /^\/api\/tasks\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === 'GET' && match) {
        const task = engine.get(match[1]!);
        if (task.repositoryId !== engine.repo.id) throw new HttpError(404, 'Task not found.');
        json(res, 200, taskView(task));
        return;
      }
      req.resume(); throw new HttpError(404, 'Route not found.');
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      if (!req.complete) {
        res.setHeader('Connection', 'close');
        res.once('finish', () => req.socket.destroy());
      }
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
      else if (error instanceof TaskNotFoundError) json(res, 404, { error: 'Task not found.' });
      else if (error instanceof z.ZodError) json(res, 400, { error: 'Invalid feedback.', issues: error.issues.map(issue => ({ path: issue.path, message: issue.message })) });
      else if (error instanceof DomainError) json(res, 409, { error: error.message });
      else { console.error('Feedback API error:', error); json(res, 500, { error: 'Could not process feedback.' }); }
    }
  };
  const server = createServer((req, res) => { void handler(req, res); });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}
