// One package manager, pnpm: package.json names it, pnpm-lock.yaml is the only lockfile, and the TypeScript
// assembler is ../assembler-typescript itself. pnpm copies a `file:` dependency into its store; `link:` keeps the
// symlink, so a rebuild in the sibling reaches this app without a reinstall.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIBLING = path.resolve(ROOT, '..', 'assembler-typescript');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('package.json pins pnpm and declares the TypeScript assembler as a link', () => {
  assert.match(pkg.packageManager ?? '', /^pnpm@\d+\.\d+\.\d+$/, 'packageManager names a pnpm version');
  assert.equal(pkg.dependencies['@contextwindowarchitecture/assembler'], 'link:../assembler-typescript');
  for (const [name, script] of Object.entries(pkg.scripts)) {
    assert.doesNotMatch(script, /\bnpm\b/, `script ${name} calls npm`);
  }
});

test('pnpm-lock.yaml is the only lockfile', () => {
  assert.ok(existsSync(path.join(ROOT, 'pnpm-lock.yaml')), 'pnpm-lock.yaml is missing: run pnpm install');
  assert.ok(!existsSync(path.join(ROOT, 'package-lock.json')), 'package-lock.json is npm\'s lockfile: remove it');
});

test(
  'the installed TypeScript assembler is ../assembler-typescript itself, not a copy',
  { skip: existsSync(SIBLING) ? false : '../assembler-typescript is not checked out' },
  () => {
    const installed = path.join(ROOT, 'node_modules', '@contextwindowarchitecture', 'assembler');
    assert.ok(existsSync(installed), 'the assembler is not installed: run pnpm install');
    assert.equal(realpathSync(installed), realpathSync(SIBLING), 'node_modules holds a copy of the sibling, not a link to it');
  },
);
