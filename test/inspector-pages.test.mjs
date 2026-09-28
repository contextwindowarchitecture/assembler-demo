// The inspector's pages and the shared column helpers. The shells carry every element the page scripts and the
// shared chrome render into, and the helpers that read a result for the column headers, the budget meter and each
// candidate's status are pure functions of the trace: they format what the assembler decided, and decide nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../src/harness/adapters.mjs';
import { columnHeads, meterFor, statusOf } from '../src/inspector/public/shared/panels.js';

const PUBLIC = path.join(ROOT, 'src', 'inspector', 'public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

test('every stage page carries the elements the scripts and the shared chrome render into', () => {
  for (const stage of ['basic', 'intermediate', 'advanced']) {
    const html = read(`${stage}/index.html`);
    for (const id of ['stages', 'agreement', 'talk', 'instruments', 'instruments-toggle', 'instruments-summary', 'candidates', 'decisions', 'request', 'answer', 'foot']) {
      assert.match(html, new RegExp(`id="${id}"`), `${stage}: #${id}`);
    }
    assert.equal((html.match(/class="column"/g) ?? []).length, 4, `${stage}: four columns`);
    assert.equal((html.match(/class="col-sub"/g) ?? []).length, 4, `${stage}: a summary line per column header`);
    assert.match(html, /class="stepband"/, `${stage}: the step band under the masthead`);
  }
});

test('the landing links every stage and names the four columns once', () => {
  const html = read('index.html');
  for (const href of ['/basic/', '/intermediate/', '/advanced/']) assert.match(html, new RegExp(`href="${href}"`));
  for (const column of ['Candidate context', 'CWA decisions', 'Outbound request', 'Model answer']) {
    assert.equal((html.match(new RegExp(column, 'g')) ?? []).length, 1, `${column} appears once, in the pipeline`);
  }
});

test('the fonts are vendored: every face the stylesheet declares is a file under public/fonts, with its license, and no page loads from the network', () => {
  const css = read('style.css');
  const urls = [...css.matchAll(/@font-face[^}]*url\(["']?([^"')]+)["']?\)/g)].map(m => m[1]);
  assert.ok(urls.length >= 6, `six faces vendored, found ${urls.length}`);
  for (const url of urls) {
    assert.match(url, /^\/fonts\/[\w.-]+\.woff2$/, url);
    assert.ok(fs.existsSync(path.join(PUBLIC, url)), `${url} exists`);
  }
  assert.doesNotMatch(css, /@import|googleapis/, 'the stylesheet imports nothing');
  for (const file of ['index.html', 'basic/index.html', 'intermediate/index.html', 'advanced/index.html']) {
    assert.doesNotMatch(read(file), /<(link|script)[^>]+(href|src)="https?:/, `${file} loads no stylesheet or script from the network`);
  }
  for (const license of ['LICENSE-IBM-Plex.txt', 'LICENSE-Newsreader.txt']) assert.match(read(`fonts/${license}`), /SIL OPEN FONT LICENSE/);
});

const trace = {
  refused: { bool: false, reason: null },
  included: [{ slot: 'governance.instructions', item_id: 'p', tokens: 51 }, { slot: 'evidence.knowledge', item_id: 'k', tokens: 30 }],
  compressed: [{ item_id: 'k', from: 66, to: 30, variant_id: 'k~summary', method: 'summarised' }],
  excluded: [{ item_id: 'x', reason: 'expired', stage: 'assembler' }, { item_id: 'm', reason: 'expired', stage: 'producer' }],
  conflicts: [], defaults_filled: [],
  result: { input_tokens: 81, hash: 'abcdef0123456789' },
};
const refused = { ...trace, refused: { bool: true, reason: 'protected_content_over_budget' }, included: [], compressed: [], result: null };

test('statusOf reads a candidate\'s outcome from the trace: an assembler exclusion, else compressed, else included', () => {
  assert.deepEqual(statusOf({ id: 'x' }, trace), { kind: 'excluded', reason: 'expired', stage: 'assembler' });
  assert.deepEqual(statusOf({ id: 'k' }, trace), { kind: 'compressed', from: 66, to: 30, variant_id: 'k~summary', method: 'summarised', tokens: 30 });
  assert.deepEqual(statusOf({ id: 'p' }, trace), { kind: 'included', tokens: 51 });
  assert.deepEqual(statusOf({ id: 'q' }, trace), { kind: 'unplaced' });
  assert.deepEqual(statusOf({ id: 'p' }, refused), { kind: 'refused' }, 'admitted, but the assembly was refused');
  assert.deepEqual(statusOf({ id: 'x' }, refused), { kind: 'excluded', reason: 'expired', stage: 'assembler' }, 'admission decisions survive a refusal');
  assert.deepEqual(statusOf({ id: 'p' }, null), { kind: 'none' });
});

test('meterFor splits the budget into content placed as sent, content placed as a summary, and what is free', () => {
  assert.deepEqual(meterFor(trace, 100), { used: 81, budget: 100, placed: 51, summarised: 30, free: 19 });
  assert.equal(meterFor(refused, 100), null, 'a refusal has no result to measure');
});

test('columnHeads says, per column, what it holds', () => {
  const snapshot = { batches: [{ items: [{}, {}], excluded: [{}] }, { items: [{}], excluded: [] }], budget: { input: 100, reserved_output: 1200 }, renderer: 'cwa-messages/v1' };
  assert.deepEqual(columnHeads({ snapshot, result: { outcome: 'assembled', trace }, variant: 'messages', answers: {} }), [
    '3 items from 2 producers · 1 reported excluded',
    '2 included · 1 compressed · 2 excluded',
    'cwa-messages/v1 · 81 tokens · hash abcdef01…',
    'not sent yet · max_tokens 1200',
  ]);
  assert.deepEqual(columnHeads({ snapshot, result: { outcome: 'refused', trace: refused }, variant: 'messages', answers: {} }), [
    '3 items from 2 producers · 1 reported excluded',
    'refused · protected_content_over_budget',
    'none: a refusal has no payload',
    'nothing to send',
  ]);
  assert.equal(columnHeads({ snapshot: { ...snapshot, renderer: 'fixture-xml/v1' }, result: { outcome: 'assembled', trace }, variant: 'fixture', answers: {} })[3], 'needs cwa-messages/v1');
  assert.equal(columnHeads({ snapshot, result: { outcome: 'assembled', trace }, variant: 'messages', answers: { local: {}, openai: {} } })[3], '2 answers');
  assert.equal(columnHeads({ snapshot, result: { outcome: 'assembled', trace }, variant: 'messages', answers: {}, recorded: true })[3], 'recorded');
  assert.deepEqual(columnHeads({ snapshot: null, result: null, variant: 'fixture', answers: {} }), ['', '', '', '']);
  assert.equal(columnHeads({ snapshot, result: { outcome: 'rejected', detail: 'bad', trace: null }, variant: 'fixture', answers: {} })[1], 'rejected');
});
