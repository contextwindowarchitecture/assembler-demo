// vendor/cwa/ is the pinned contract: every file matches its SHA-256 in vendor/cwa.lock.json, and nothing is
// vendored that the lock does not name. Change it only with `npm run vendor -- <website checkout>`.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const VENDOR = path.join(ROOT, 'vendor', 'cwa');

function files(dir, base = dir) {
  return readdirSync(dir).flatMap(name => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? files(file, base) : [path.relative(base, file).split(path.sep).join('/')];
  });
}

test('every vendored file matches its lock entry, and every lock entry is vendored', () => {
  const lock = JSON.parse(readFileSync(path.join(ROOT, 'vendor', 'cwa.lock.json'), 'utf8'));
  const vendored = files(VENDOR).sort();
  assert.deepEqual(vendored, Object.keys(lock.files).sort(), 'vendored files differ from the lock');
  for (const [file, digest] of Object.entries(lock.files)) {
    const actual = createHash('sha256').update(readFileSync(path.join(VENDOR, file))).digest('hex');
    assert.equal(actual, digest, `${file} does not match its lock entry`);
  }
  assert.match(lock.website_commit, /^[0-9a-f]{40}$/);
});
