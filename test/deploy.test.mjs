// The container image: the Containerfile expects a build context that holds this repository and the assembler
// checkouts assemblers.json names, side by side, each under its own name, and deploy/stage-context.sh writes that
// context from the working trees: exactly the files git lists (tracked and untracked, nothing ignored), so no
// node_modules, no .venv, no built adapter, and never .env.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const config = JSON.parse(readFileSync(path.join(ROOT, 'assemblers.json'), 'utf8'));
const checkouts = Object.entries(config).filter(([id]) => !id.startsWith('$')).map(([, entry]) => entry.checkout);
const trees = [['cwa-demo-app', ROOT], ...checkouts.map(c => [path.basename(c), path.resolve(ROOT, c)])];
const allPresent = trees.every(([, dir]) => existsSync(path.join(dir, '.git')));

test('the Containerfile copies this repository and every checkout assemblers.json names, each under its own name', () => {
  const file = readFileSync(path.join(ROOT, 'Containerfile'), 'utf8');
  const copied = [...file.matchAll(/^COPY (?!--from)([^/\s]+)\//gm)].map(m => m[1]);
  assert.deepEqual([...new Set(copied)].sort(), trees.map(([name]) => name).sort());
});

test(
  'stage-context.sh writes the four working trees side by side: what git lists, nothing it ignores, never .env',
  { skip: allPresent ? false : 'a checkout is missing or is not a git checkout' },
  () => {
    const context = mkdtempSync(path.join(tmpdir(), 'cwa-context-'));
    try {
      const report = execFileSync('bash', [path.join(ROOT, 'deploy', 'stage-context.sh'), context], { encoding: 'utf8' });
      for (const [name, dir] of trees) {
        assert.match(report, new RegExp(`^${name}=[0-9a-f]{7,}(-dirty)?$`, 'm'), `the report names ${name} with its revision`);
        const listed = execFileSync('git', ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
          .split('\0').filter(file => file && existsSync(path.join(dir, file)));
        const staged = readdirSync(path.join(context, name), { recursive: true, withFileTypes: true })
          .filter(entry => !entry.isDirectory())
          .map(entry => path.relative(path.join(context, name), path.join(entry.parentPath, entry.name)));
        assert.deepEqual(staged.sort(), listed.sort(), `${name} is staged as git lists it`);
      }
      assert.ok(existsSync(path.join(context, 'cwa-demo-app', 'Containerfile')));
      for (const ignored of ['.env', 'node_modules', 'bin', 'producers/.venv']) {
        assert.ok(!existsSync(path.join(context, 'cwa-demo-app', ignored)), `${ignored} is not staged`);
      }
    } finally {
      rmSync(context, { recursive: true, force: true });
    }
  },
);
