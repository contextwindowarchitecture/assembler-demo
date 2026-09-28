// The inspector's pages and the shared column helpers. The shells carry every element the page scripts and the
// shared chrome render into, and the helpers that read a result for the column headers, the budget meter and each
// candidate's status are pure functions of the trace: they format what the assembler decided, and decide nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../src/harness/adapters.mjs';
import { columnHeads, meterFor, planeOf, statusOf } from '../src/inspector/public/shared/panels.js';
import { resolveTheme, themeLabel } from '../src/inspector/public/shared/chrome.js';

const PUBLIC = path.join(ROOT, 'src', 'inspector', 'public');
const read = file => fs.readFileSync(path.join(PUBLIC, file), 'utf8');

test('every stage page carries the elements the scripts and the shared chrome render into', () => {
  for (const stage of ['basic', 'intermediate', 'advanced']) {
    const html = read(`${stage}/index.html`);
    for (const id of ['stages', 'agreement', 'talk', 'theme', 'instruments', 'instruments-toggle', 'instruments-summary', 'candidates', 'decisions', 'request', 'answer', 'foot']) {
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
  for (const id of ['talk', 'theme']) assert.match(html, new RegExp(`id="${id}"`), `the landing carries the same masthead buttons: #${id}`);
  for (const column of ['Candidate context', 'CWA decisions', 'Outbound request', 'Model answer']) {
    assert.equal((html.match(new RegExp(column, 'g')) ?? []).length, 1, `${column} appears once, in the pipeline`);
  }
});

test('the fonts are vendored: the two faces the guide names, each a file under public/fonts with its licence, and no page loads from the network', () => {
  const css = read('style.css');
  const faces = [...css.matchAll(/@font-face\s*{([^}]*)}/g)].map(m => ({
    family: m[1].match(/font-family:\s*"([^"]+)"/)[1],
    url: m[1].match(/url\(["']?([^"')]+)["']?\)/)[1],
  }));
  assert.deepEqual([...new Set(faces.map(f => f.family))].sort(), ['IBM Plex Mono', 'Space Grotesk'], 'Space Grotesk for reading, IBM Plex Mono for labels and code, nothing else');
  for (const { url } of faces) {
    assert.match(url, /^\/fonts\/[\w.-]+\.woff2$/, url);
    assert.ok(fs.existsSync(path.join(PUBLIC, url)), `${url} exists`);
  }
  const vendored = fs.readdirSync(path.join(PUBLIC, 'fonts')).filter(f => f.endsWith('.woff2')).map(f => `/fonts/${f}`).sort();
  assert.deepEqual(vendored, [...new Set(faces.map(f => f.url))].sort(), 'every vendored file is declared, and nothing else is vendored');
  assert.doesNotMatch(css, /@import|googleapis/, 'the stylesheet imports nothing');
  for (const file of ['index.html', 'basic/index.html', 'intermediate/index.html', 'advanced/index.html']) {
    assert.doesNotMatch(read(file), /<(link|script)[^>]+(href|src)="https?:/, `${file} loads no stylesheet or script from the network`);
  }
  for (const license of ['LICENSE-IBM-Plex.txt', 'LICENSE-Space-Grotesk.txt']) assert.match(read(`fonts/${license}`), /SIL OPEN FONT LICENSE/);
  assert.match(fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8'), /Space Grotesk/, 'NOTICE lists the face');
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8'), /Newsreader|Plex Sans/, 'NOTICE no longer lists faces that are gone');
});

test('the theme is the website\'s: an attribute on <html> the masthead toggles, remembered under the site\'s key, light unless chosen', () => {
  const css = read('style.css');
  assert.match(css, /html\[data-theme="dark"\]\s*{/, 'the dark tokens override on the attribute');
  assert.doesNotMatch(css, /prefers-color-scheme/, 'the OS preference is not consulted');
  const chrome = read('shared/chrome.js');
  assert.match(chrome, /THEME_KEY = 'cwa-theme'/, 'the storage key is the website\'s, so a choice made on the site carries over');
  assert.equal(resolveTheme(null), 'light', 'no choice stored: light, which a projector reads better');
  assert.equal(resolveTheme('dark'), 'dark');
  assert.equal(resolveTheme('light'), 'light');
  assert.equal(resolveTheme('sepia'), 'light', 'an unknown value falls back to light');
  assert.equal(themeLabel('light'), 'dark', 'the toggle names the theme you would switch to');
  assert.equal(themeLabel('dark'), 'light');
});

test('the stylesheet carries the style guide\'s token block verbatim, and no colour outside it', () => {
  const css = read('style.css');
  const guide = fs.readFileSync(path.join(ROOT, 'STYLE.md'), 'utf8');
  const block = guide.match(/```css\n(:root {\n[\s\S]*?\n})\n```/)[1];
  assert.match(block, /--p-inter: oklch\(0\.76 0\.13 310\);\n}$/, 'the guide\'s block ends with the dark plane colours');
  assert.ok(css.includes(block), 'style.css contains the token block from STYLE.md section 2, verbatim');
  const rest = css.replace(block, '');
  const literal = rest.match(/#[0-9a-fA-F]{3,8}(?![\w-])|\b(rgba?|hsla?|oklch|oklab|lab|lch)\(/);
  assert.equal(literal, null, `a colour literal outside the token block: ${literal?.[0]} near "${rest.slice(Math.max(0, (literal?.index ?? 0) - 40), (literal?.index ?? 0) + 40)}"`);
  const mixes = [...rest.matchAll(/color-mix\((?:[^()]|\([^()]*\))*\)/g)].map(m => m[0]);
  assert.deepEqual([...new Set(mixes)].sort(), ['color-mix(in oklab, var(--bg) 88%, transparent)', 'color-mix(in oklab, var(--plane) 50%, transparent)'], 'the two permitted mixes only');
});

test('hairlines and squares, no motion, two typefaces: the rules a test can check', () => {
  const css = read('style.css').replace(/@font-face\s*{[^}]*}/g, '');
  for (const banned of ['box-shadow', 'transition', '@keyframes', 'animation', 'text-shadow', 'gradient']) assert.doesNotMatch(css, new RegExp(banned), `no ${banned}`);
  const radii = [...css.matchAll(/border-radius:\s*([^;]+);/g)].map(m => m[1].trim());
  assert.ok(radii.length > 0, 'the pill is used');
  assert.deepEqual([...new Set(radii)], ['var(--pill)'], 'the only radius is the pill');
  const families = [...css.matchAll(/font-family:\s*([^;]+);/g)].map(m => m[1].trim());
  for (const family of new Set(families)) assert.ok(['var(--sans)', 'var(--mono)', 'inherit'].includes(family), `font-family ${family}: every family is one of the two tokens`);
  assert.doesNotMatch(css, /!important/, 'nothing needs !important, since nothing is styled inline');
  for (const file of ['index.html', 'basic/index.html', 'intermediate/index.html', 'advanced/index.html']) {
    assert.doesNotMatch(read(file), /\sstyle="/, `${file} carries no inline style`);
  }
});

test('planeOf names the plane a slot belongs to, by the part of its id before the dot', () => {
  assert.equal(planeOf('governance.instructions'), 'gov');
  assert.equal(planeOf('governance.output_contract'), 'gov');
  assert.equal(planeOf('state.task'), 'state');
  assert.equal(planeOf('evidence.knowledge'), 'evid');
  assert.equal(planeOf('evidence.tool_results'), 'evid');
  assert.equal(planeOf('interaction.query'), 'inter');
  assert.equal(planeOf('interaction.memory'), 'inter');
  assert.equal(planeOf('custom.slot'), null, 'a slot outside the four planes has no colour');
  assert.equal(planeOf(undefined), null);
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

test('meterFor splits the budget into content placed as sent, content placed as a summary, and what is free, one segment per included item in its plane', () => {
  assert.deepEqual(meterFor(trace, 100), {
    used: 81, budget: 100, placed: 51, summarised: 30, free: 19,
    segments: [
      { item_id: 'p', slot: 'governance.instructions', plane: 'gov', tokens: 51, compressed: false },
      { item_id: 'k', slot: 'evidence.knowledge', plane: 'evid', tokens: 30, compressed: true },
    ],
  });
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
