import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

async function main() {
  const token = (await readFile(resolve(process.env.DATA_DIR || '.local', 'feedback-api-token'), 'utf8')).trim();
  const port = Number(process.env.FEEDBACK_PORT || '4318');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid FEEDBACK_PORT.');
  const [action, id] = process.argv.slice(2);
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  let path = '/api/feedback';
  let body: string | undefined;
  if (action === 'status') {
    if (!id || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('Use npm run feedback:send -- status TASK_ID');
    path = `/api/tasks/${id}`;
  } else {
    body = await readFile(action || 'examples/feedback-api.json', 'utf8');
    JSON.parse(body);
  }
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: body ? 'POST' : 'GET', headers, body, signal: AbortSignal.timeout(15_000),
  });
  const result = await response.json();
  console.log(JSON.stringify(result, null, 2));
  if (!response.ok) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
