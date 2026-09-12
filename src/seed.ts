import { cp, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { command } from './git.js';
import type { Repository } from './domain.js';

export const fixtureBug = `export function exportCsv(rows, columns = ['name', 'email']) {
  const fields = Object.keys(rows[0]);
  return [fields.join(','), ...rows.map(row => fields.map(field => row[field] ?? '').join(','))].join('\\n');
}
`;

export async function seedRepository(root: string, product = false): Promise<Repository> {
  const path = resolve(root, 'customer-demo');
  // mkdir without recursive fails rather than overwriting an existing demo repository.
  await mkdir(root, { recursive: true });
  await mkdir(path);
  if (product) await cp(new URL('../examples/mini-crm/', import.meta.url), path, { recursive: true });
  await writeFile(resolve(path, 'export.mjs'), fixtureBug);
  await writeFile(resolve(path, 'export.test.mjs'), `import test from 'node:test';
import assert from 'node:assert/strict';
import { exportCsv } from './export.mjs';
test('exports a populated row', () => {
  assert.equal(exportCsv([{ name: 'Ada', email: 'ada@example.test' }]), 'name,email\\nAda,ada@example.test');
});
`);
  await command(path, 'git', ['init', '-b', 'main']);
  await command(path, 'git', ['add', '.']);
  await command(path, 'git', ['-c', 'user.name=Auto Iteration Demo', '-c', 'user.email=demo@example.test',
    '-c', 'commit.gpgsign=false', 'commit', '-m', 'Add deliberately incomplete CSV export fixture']);
  return { id: 'customer-demo', path, baseRef: 'main', testCommand: [process.execPath, '--test'] };
}
