import { readFile, realpath } from 'node:fs/promises';
import { relative, resolve, extname } from 'node:path';
import type { ServerResponse } from 'node:http';
import type { Engine } from './engine.js';
import { TaskNotFoundError } from './domain.js';

/** Static frontend preview only; never execute an agent-generated server on the host. */
export async function serveProduct(engine: Engine, path: string, res: ServerResponse, trustedRoot?: string): Promise<boolean> {
  let root = trustedRoot ?? engine.repo.path;
  let asset = path.slice(1) || 'index.html';
  const preview = /^\/preview\/([a-f0-9-]{36})\/(.*)$/.exec(path);
  if (preview) {
    if (trustedRoot) return false;
    let task;
    try { task = engine.get(preview[1]!); }
    catch (error) {
      if (error instanceof TaskNotFoundError) return false;
      throw error;
    }
    if (task.repositoryId !== engine.repo.id || task.status !== 'changes_ready' || !task.result) return false;
    root = task.result.workspace;
    asset = preview[2] || 'index.html';
  }
  const types: Record<string, string> = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript' };
  const type = types[extname(asset)];
  if (!type || !/^[\w./-]+$/.test(asset) || asset.split('/').some(part => part.startsWith('.'))) return false;
  try {
    const base = await realpath(root);
    const file = await realpath(resolve(base, asset));
    const inside = relative(base, file);
    if (inside.startsWith('..') || inside.startsWith('/')) return false;
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': `${type}; charset=utf-8`, 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'" });
    res.end(body); return true;
  } catch (error) {
    if (['ENOENT', 'EISDIR'].includes((error as NodeJS.ErrnoException).code || '')) return false;
    throw error;
  }
}
