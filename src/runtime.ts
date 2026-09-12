import 'dotenv/config';
import { resolve } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Store } from './store.js';
import { Engine } from './engine.js';
import { DemoProvider, CodexProvider } from './providers.js';
import { DomainError, type Repository } from './domain.js';
import { OpenRouterConversation } from './conversation.js';

export function runtime() {
  const root = resolve(process.env.DATA_DIR || '.local');
  mkdirSync(root, { recursive: true });
  const mode = process.env.EXECUTOR || 'demo';
  if (!['demo', 'codex'].includes(mode)) throw new DomainError('EXECUTOR must be demo or codex.');
  if (mode === 'codex' && !process.env.TARGET_REPO_PATH) throw new DomainError('Set TARGET_REPO_PATH for live mode.');
  const path = mode === 'demo' ? resolve(root, 'customer-demo') : resolve(process.env.TARGET_REPO_PATH!);
  if (!existsSync(path)) throw new DomainError('Repository does not exist. Run npm run cli -- init for the demo.');
  const testCommand: unknown = mode === 'demo' ? [process.execPath, '--test']
    : JSON.parse(process.env.TEST_COMMAND_JSON || '[]');
  if (!Array.isArray(testCommand) || !testCommand.length || testCommand.some(arg => typeof arg !== 'string' || !arg)) {
    throw new DomainError('Set TEST_COMMAND_JSON to a trusted executable and argument array, e.g. ["npm","test"].');
  }
  const repositoryId = `${mode}-${createHash('sha256').update(path).digest('hex').slice(0, 16)}`;
  const repo: Repository = { id: repositoryId, path,
    baseRef: process.env.TARGET_BASE_REF || 'main', testCommand };
  const store = new Store(resolve(root, 'state.sqlite'));
  const conversationMode = process.env.CONVERSATION_PROVIDER || 'codex';
  if (!['codex', 'openrouter'].includes(conversationMode)) { store.close(); throw new DomainError('CONVERSATION_PROVIDER must be codex or openrouter.'); }
  let conversation;
  try { conversation = conversationMode === 'openrouter'
    ? new OpenRouterConversation(process.env.OPENROUTER_API_KEY || '', process.env.OPENROUTER_MODEL || '') : undefined; }
  catch (error) { store.close(); throw error; }
  const engine = new Engine(store, process.env.ORGANIZATION_ID || 'demo-company', repo,
    mode === 'demo' ? new DemoProvider() : new CodexProvider(process.env.CODEX_MODEL), root, undefined, conversation);
  return { store, engine, root };
}
