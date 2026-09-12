import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { Engine } from './engine.js';
import { DomainError, inputSchema } from './domain.js';

const bodySchema = inputSchema.omit({ source: true }).strict();
const maxBytes = 64 * 1024;
class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req: IncomingMessage): Promise<unknown> {
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
    let oversized = false;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        oversized = true; chunks.length = 0;
        reject(new HttpError(413, 'Request body exceeds 64 KiB.'));
      } else if (!oversized) chunks.push(chunk);
    });
    req.on('end', () => {
      if (oversized) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Invalid JSON.')); }
    });
    req.on('error', reject);
    req.on('aborted', () => reject(new HttpError(400, 'Request aborted.')));
  });
}

/** Local demo intake only. It exposes no approval or execution-control endpoint. */
export function feedbackServer(engine: Engine, token: string) {
  if (token.length < 24) throw new Error('The feedback API token must contain at least 24 characters.');
  const expected = Buffer.from(`Bearer ${token}`);
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    try {
      const path = new URL(req.url || '/', 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/health') {
        json(res, 200, { status: 'ok', product: 'Demo CRM', mode: 'scripted-demo' }); return;
      }
      const actual = Buffer.from(req.headers.authorization || '');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        req.resume(); throw new HttpError(401, 'A valid intake bearer token is required.');
      }
      if (req.method === 'POST' && path === '/api/feedback') {
        const feedback = bodySchema.parse(await readJson(req));
        const result = engine.submit({ ...feedback, source: 'demo-http' });
        res.setHeader('Location', `/api/tasks/${result.task.id}`);
        json(res, result.duplicate ? 200 : 202, { taskId: result.task.id, status: result.task.status,
          duplicate: result.duplicate, product: 'Demo CRM', statusUrl: `/api/tasks/${result.task.id}` });
        return;
      }
      const match = /^\/api\/tasks\/([a-f0-9-]{36})$/.exec(path);
      if (req.method === 'GET' && match) {
        let task;
        try { task = engine.get(match[1]!); } catch { throw new HttpError(404, 'Task not found.'); }
        json(res, 200, { taskId: task.id, product: 'Demo CRM', mode: 'scripted-demo', status: task.status,
          feedback: task.feedback, plan: task.plans.at(-1) ?? null, comments: task.comments,
          approval: task.approval ?? null, result: task.result ?? null, error: task.error ?? null });
        return;
      }
      req.resume(); throw new HttpError(404, 'Route not found.');
    } catch (error) {
      if (res.destroyed || res.headersSent) return;
      if (error instanceof HttpError) json(res, error.status, { error: error.message });
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
