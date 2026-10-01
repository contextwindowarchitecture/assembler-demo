// The inspector's pages and the shared column helpers. The shells carry every element the page scripts and the
// shared chrome render into, and the helpers that read a result for the column headers, the budget meter and each
// candidate's status are pure functions of the trace: they format what the assembler decided, and decide nothing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../src/harness/adapters.mjs';
import { columnHeads, meterFor, planeOf, statusOf } from '../src/inspector/public/shared/panels.js';
import { resolveTheme, stepperHit, themeLabel } from '../src/inspector/public/shared/chrome.js';
import { ROOT as APP_ROOT, stageNav, url } from '../src/inspector/public/shared/format.js';
import { pathToFileURL } from 'node:url';

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
    const top = html.match(/<header class="top">([\s\S]*?)<\/header>/)?.[1] ?? '';
    assert.match(top, /class="stepband"/, `${stage}: the step band is in the pinned block`);
    assert.match(top, /id="instruments"/, `${stage}: the instruments are in the pinned block, so they stay while the page scrolls`);
  }
});

test('the landing links every stage and names the four columns once', () => {
  const html = read('index.html');
  for (const href of ['basic/', 'intermediate/', 'advanced/']) assert.match(html, new RegExp(`href="${href}"`));
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
  for (const { url: file } of faces) {
    assert.match(file, /^fonts\/[\w.-]+\.woff2$/, file);
    assert.ok(fs.existsSync(path.join(PUBLIC, file)), `${file} exists`);
  }
  const vendored = fs.readdirSync(path.join(PUBLIC, 'fonts')).filter(f => f.endsWith('.woff2')).map(f => `fonts/${f}`).sort();
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

/** The inverse block the guide derives from the website's block: the other theme's value of every token but the planes. */
function inverseBlockOf(block) {
  const [, light, dark] = block.match(/^:root {\n([\s\S]*?)\n}\nhtml\[data-theme="dark"\] {\n([\s\S]*?)\n}$/);
  const values = text => Object.fromEntries([...text.matchAll(/--([\w-]+): ([^;]+);/g)].map(m => [m[1], m[2]]));
  const l = values(light);
  const d = values(dark);
  const names = Object.keys(l).filter(name => !name.startsWith('p-') && name in d);
  const lines = from => names.map(name => `  --inv-${name}: ${from[name]};`).join('\n');
  return `:root {\n${lines(d)}\n}\nhtml[data-theme="dark"] {\n${lines(l)}\n}`;
}

test('the stylesheet carries the style guide\'s token block verbatim, the inverse block derived from it, and no colour outside them', () => {
  const css = read('style.css');
  const guide = fs.readFileSync(path.join(ROOT, 'STYLE.md'), 'utf8');
  const block = guide.match(/```css\n(:root {\n[\s\S]*?\n})\n```/)[1];
  assert.match(block, /--p-inter: oklch\(0\.76 0\.13 310\);\n}$/, 'the guide\'s block ends with the dark plane colours');
  assert.ok(css.includes(block), 'style.css contains the token block from STYLE.md section 2, verbatim');
  const inverse = inverseBlockOf(block);
  assert.match(inverse, /^:root {\n  --inv-bg: oklch\(0\.175 0\.008 80\);\n/, 'on a light page the inverse ground is the dark theme\'s');
  assert.match(inverse, /--inv-accent-soft: oklch\(0\.94 0\.035 45\);\n}$/, 'and on a dark page the inverse accent-soft is the light theme\'s');
  assert.ok(css.includes(inverse), 'style.css carries the inverse block: the other theme\'s value of every token but the planes, derived from the website\'s block');
  assert.ok(guide.includes(inverse), 'STYLE.md section 2 shows the same inverse block');
  const rest = css.replace(block, '').replace(inverse, '');
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

test('the four columns sit two per row at every width above the one-column breakpoint, with an arrow into the second of each row', () => {
  const css = read('style.css');
  const base = css.slice(0, css.indexOf('@media'));
  assert.match(base, /\.columns\s*{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)/, 'the default .columns rule is two per row');
  assert.doesNotMatch(css, /repeat\(4,/, 'nothing lays the columns out four across');
  assert.match(base, /\.column:nth-child\(even\) h2::before\s*{[^}]*content:\s*"→"/, 'the arrow points into the second column of each row');
  const medias = [...css.matchAll(/@media \(max-width: (\d+)px\)\s*{([\s\S]*?)\n}/g)].map(m => [Number(m[1]), m[2]]);
  const stacked = medias.find(([, body]) => /\.columns\s*{[^}]*grid-template-columns:\s*1fr/.test(body));
  assert.ok(stacked, 'one breakpoint stacks the columns');
  for (const [width, body] of medias) {
    if (width > stacked[0]) assert.doesNotMatch(body, /\.columns\s*{[^}]*grid-template-columns/, `${width}px: the columns keep their two-per-row grid`);
  }
  assert.match(stacked[1], /\.column h2\s*{[^}]*position:\s*static/, 'stacked, the headers stop sticking');
  assert.match(stacked[1], /\.column h2::before\s*{[^}]*display:\s*none/, 'stacked, the arrows go');
});

test('the landing hero keeps both columns down to 1100px, where the pipeline grid still has room beside the headline', () => {
  const css = read('style.css');
  const medias = [...css.matchAll(/@media \(max-width: (\d+)px\)\s*{([\s\S]*?)\n}/g)].map(m => [Number(m[1]), m[2]]);
  const stacks = medias.filter(([, body]) => /\.hero\s*{[^}]*grid-template-columns:\s*1fr/.test(body)).map(([width]) => width);
  assert.deepEqual(stacks, [1100], 'one breakpoint stacks the hero, at 1100px: stacked at 1400px, the right half of the hero sat empty on every laptop');
  const widths = medias.map(([width]) => width);
  assert.deepEqual(widths, [...widths].sort((a, b) => b - a), 'the breakpoints are in descending order');
});

test('every select sits in a .select wrapper, and the stylesheet draws its caret clear of the edge, in a token colour', () => {
  const css = read('style.css');
  assert.match(css, /\.select select\s*{[^}]*appearance: none/, 'the native caret is off');
  assert.match(css, /\.select::after\s*{[^}]*var\(--muted\)/, 'the caret is drawn by the stylesheet in the muted token');
  const files = ['basic/index.html', 'intermediate/index.html', 'advanced/index.html', 'shared/panels.js'];
  for (const file of files) {
    const text = read(file);
    const selects = (text.match(/<select\b/g) ?? []).length;
    const wrapped = (text.match(/<span class="select"><select\b/g) ?? []).length;
    assert.ok(selects > 0, `${file} has a select`);
    assert.equal(wrapped, selects, `${file}: every select is wrapped`);
  }
});

test('every number input sits in a .number wrapper whose stepper the stylesheet draws clear of the edge, and a click in the stepper zone steps', () => {
  const css = read('style.css');
  assert.match(css, /\.number input\s*{[^}]*appearance: textfield/, 'the native spinner is off');
  assert.match(css, /\.number input::-webkit-inner-spin-button[^{]*{[^}]*appearance: none/, 'and hidden in WebKit');
  assert.match(css, /\.number::before[^{]*{[^}]*var\(--muted\)/, 'the up chevron is drawn in the muted token');
  assert.match(css, /\.number::after[^{]*{[^}]*var\(--muted\)/, 'and the down chevron');
  for (const file of ['basic/index.html', 'intermediate/index.html']) {
    const text = read(file);
    const inputs = (text.match(/<input\b[^>]*type="number"/g) ?? []).length;
    const wrapped = (text.match(/<span class="number"><input\b[^>]*type="number"/g) ?? []).length;
    assert.ok(inputs > 0, `${file} has a number input`);
    assert.equal(wrapped, inputs, `${file}: every number input is wrapped`);
  }
  const box = { right: 300, top: 100, height: 30 };
  assert.equal(stepperHit({ x: 290, y: 105 }, box), 'up', 'the upper half of the stepper zone steps up');
  assert.equal(stepperHit({ x: 290, y: 125 }, box), 'down', 'the lower half steps down');
  assert.equal(stepperHit({ x: 290, y: 115 }, box), 'down', 'the middle counts as the lower half');
  assert.equal(stepperHit({ x: 260, y: 105 }, box), null, 'a click in the text is not a step');
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

test('every page carries the glossary: a lowercase masthead button right of the theme toggle, and a panel outside the pinned block', () => {
  for (const file of ['index.html', 'basic/index.html', 'intermediate/index.html', 'advanced/index.html']) {
    const html = read(file);
    for (const id of ['glossary-toggle', 'glossary', 'glossary-filter', 'glossary-close', 'glossary-body']) assert.match(html, new RegExp(`id="${id}"`), `${file}: #${id}`);
    const right = html.match(/<div class="masthead-right">([\s\S]*?)<\/div>/)?.[1] ?? '';
    assert.match(right, /id="theme"[\s\S]*<button id="glossary-toggle"[^>]*>glossary<\/button>/, `${file}: the glossary button follows the theme button, lowercase like it`);
    const top = html.match(/<header class="top">([\s\S]*?)<\/header>/)?.[1] ?? '';
    assert.doesNotMatch(top, /id="glossary"/, `${file}: the panel is not in the pinned block, whose measured height the columns pin under`);
    assert.match(html, /<aside class="glossary" id="glossary" hidden/, `${file}: the panel starts closed`);
  }
  const css = read('style.css');
  assert.match(css, /\.glossary\s*{[^}]*position: fixed/, 'the panel is fixed over the page');
  assert.match(css, /\.glossary\s*{[^}]*z-index: 40/, 'under the pinned block (50), above the column headers (2)');
});

test('the pages reach the server by URLs relative to their own, so a path prefix in front of the inspector works', () => {
  // Markup and styles carry no absolute path: a stage page says ../style.css, the stylesheet says fonts/…
  const files = fs.readdirSync(PUBLIC, { recursive: true }).filter(f => /\.(html|css|js)$/.test(f));
  assert.ok(files.length > 10, 'the pages were found');
  for (const file of files) assert.doesNotMatch(read(file), /\b(href|src)="\/|url\(["']?\//, `${file} carries an absolute path`);
  // Scripts name app-root paths and the helpers resolve them against the root the module derives from its own URL.
  assert.equal(APP_ROOT.href, pathToFileURL(PUBLIC + '/').href);
  assert.equal(url('/api/state'), `${APP_ROOT.href}api/state`);
  assert.equal(url('api/state'), `${APP_ROOT.href}api/state`);
  const nav = stageNav('basic');
  for (const stage of ['basic', 'intermediate', 'advanced']) assert.match(nav, new RegExp(`href="${APP_ROOT.href}${stage}/"`));
  // The landing page fixes a prefix typed without its slash, under which every relative link would resolve one level up.
  assert.match(read('index.html'), /location\.pathname\.endsWith\('\/'\)/);
});

test('every stage page carries the guided tour: a band after the pinned block and a masthead button, and the landing starts each tour', () => {
  for (const stage of ['basic', 'intermediate', 'advanced']) {
    const html = read(`${stage}/index.html`);
    const top = html.match(/<header class="top">([\s\S]*?)<\/header>/)?.[1] ?? '';
    assert.doesNotMatch(top, /id="tour"/, `${stage}: the band is not in the pinned block, whose measured height the column headers and the rail sit under`);
    assert.match(html, /<\/header>\s*<section class="tour" id="tour" hidden/, `${stage}: the band follows the pinned block and starts closed`);
    const right = html.match(/<div class="masthead-right">([\s\S]*?)<\/div>/)?.[1] ?? '';
    assert.match(right, /<button id="tour-toggle" type="button" aria-pressed="false" hidden>Take the tour<\/button>/, `${stage}: the masthead button, hidden until the page has a tour`);
  }
  const landing = read('index.html');
  for (const stage of ['basic', 'intermediate', 'advanced']) {
    if (!fs.existsSync(path.join(PUBLIC, 'shared', 'tours', `${stage}.js`))) continue;
    assert.match(landing, new RegExp(`href="${stage}/\\?tour=1"`), `the landing starts the ${stage} tour`);
  }
});

test('the tour band is the one inverse surface: the other theme\'s tokens, fixed over the page as a rail, or a dock below 1280px', () => {
  const css = read('style.css');
  const base = css.slice(0, css.indexOf('@media'));
  for (const token of ['bg', 'surface', 'fg', 'muted', 'line', 'accent', 'accent-soft']) {
    assert.match(base, new RegExp(`\\.tour\\s*{[^}]*--${token}: var\\(--inv-${token}\\)`), `the band swaps --${token} to the other theme's`);
  }
  assert.match(base, /\.tour\s*{[^}]*position: fixed/, 'the band is fixed over the page, not in the flow');
  assert.match(base, /\.tour\s*{[^}]*z-index: 39/, 'under the glossary (40), which covers it while open, and above the column headers (2)');
  assert.match(base, /\.tour\s*{[^}]*top: var\(--top-h/, 'the rail starts under the pinned block');
  assert.match(base, /\.tour\s*{[^}]*width: 400px/, 'the rail is the glossary\'s width');
  assert.match(base, /\.tour\[hidden\]\s*{[^}]*display: none/, 'a closed band leaves no strip behind');
  assert.match(base, /\.tour\.invite\s*{[^}]*top: auto/, 'the invite is always the dock');
  assert.match(base, /:root\[data-touring="1"\] body\s*{[^}]*padding-right: 400px/, 'the page makes room for the rail');
  assert.match(base, /:root\[data-touring="1"\] \.instruments \.controls \.hint\s*{[^}]*display: none/, 'the instruments\' arrow-key hint hides while the arrows move stops');
  const dock = [...css.matchAll(/@media \(max-width: (\d+)px\)\s*{([\s\S]*?)\n}/g)].find(m => /\.tour\s*{[^}]*top: auto/.test(m[2]));
  assert.ok(dock, 'one breakpoint turns the rail into the dock');
  assert.equal(Number(dock[1]), 1280, 'at 1280px and below, two columns in 400px less would be too narrow');
  assert.match(dock[2], /:root\[data-touring="1"\] body\s*{[^}]*padding-bottom: var\(--tour-h/, 'the page makes room for the dock, whose height the band measures');
  assert.match(dock[2], /:root:has\(\.glossary:not\(\[hidden\]\)\) \.tour\s*{[^}]*right: 400px/, 'the dock stops at the open glossary\'s edge');
  assert.match(css, /\.tour-target\s*{[^}]*outline: 2px solid var\(--fg\)/, 'what a stop points at is outlined in the page\'s ink');
  assert.doesNotMatch(css, /body::before/, 'nothing dims the page: the copy names two places at once');
  assert.match(read('shared/tour-band.js'), /'--tour-h'/, 'the band keeps --tour-h at its measured height');
});

test('what a stop points at carries a flag in the band\'s colours: the stop\'s number and "look here" on its top edge', () => {
  const css = read('style.css');
  assert.match(css, /\.tour-target\s*{[^}]*position: relative/, 'the flag is placed against the target');
  assert.match(css, /\.tour-target::after\s*{[^}]*content: attr\(data-tour-stop\) " · look here"/, 'the flag reads the stop\'s number from the target and says where to look');
  assert.match(css, /\.tour-target::after\s*{[^}]*background: var\(--inv-bg\)/, 'in the band\'s ground');
  assert.match(css, /\.tour-target::after\s*{[^}]*color: var\(--inv-fg\)/, 'and the band\'s type');
  assert.match(css, /\.tour-target::after\s*{[^}]*border-radius: var\(--pill\)/, 'a pill, like every chip');
  assert.match(css, /\.tour-target\s*{[^}]*scroll-margin-top: calc\(var\(--top-h, calc\(var\(--mast-h\) \+ var\(--band-h\)\)\) \+ 104px\)/, 'the target scrolls to 104px under the pinned block: clear of its column\'s sticky header, with room for the flag above it');
  assert.match(read('shared/tour-band.js'), /dataset\.tourStop = String\(tour\.index\)/, 'the band writes the stop\'s number on the target');
});
