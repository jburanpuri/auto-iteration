import 'dotenv/config';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { seedRepository } from './seed.js';

export async function prepareProductDemo() {
  // Separate data from the old two-file fixture. Explicit rehearsal mode never masquerades as AI.
  const root = resolve(process.env.DEMO_DATA_DIR || '.local/northstar-company-demo');
  const target = resolve(root, 'customer-demo');
  try { await access(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    await seedRepository(root, true);
  }
  await access(resolve(target, 'index.html'));
  process.env.DATA_DIR = root;
  process.env.EXECUTOR = process.env.DEMO_EXECUTOR || 'codex';
  process.env.TARGET_REPO_PATH = target;
  process.env.TARGET_BASE_REF = 'main';
  process.env.TEST_COMMAND_JSON = JSON.stringify([process.execPath, '--test']);
  return root;
}
