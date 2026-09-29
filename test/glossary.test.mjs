// The glossary: the words the spec and the demo use, in one panel behind a masthead button. The entries are data
// (terms.js) the panel renders (glossary.js); a reason code opens it with the registry text from the contract the
// page already loaded. Nothing here decides anything an assembler owns.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../src/harness/adapters.mjs';
import { TERMS, slugOf } from '../src/inspector/public/shared/terms.js';
import { filterTerms, reasonEntry, renderGlossary } from '../src/inspector/public/shared/glossary.js';
import { reasonChip } from '../src/inspector/public/shared/format.js';

const contract = (() => {
  const read = name => JSON.parse(readFileSync(path.join(ROOT, 'vendor', 'cwa', 'contract', name), 'utf8'));
  const reasons = read('reasons.json');
  return { reasons: Object.fromEntries(reasons.map(r => [r.code, r])), slot_defaults: read('slot-defaults.json'), requirements: read('requirements.json') };
})();

test('every entry names a term, a kind and a definition, and cites only rules and terms that exist', () => {
  const terms = new Set();
  const ids = new Set(contract.requirements.map(r => r.id));
  for (const entry of TERMS) {
    assert.ok(typeof entry.term === 'string' && entry.term.length, 'a term');
    assert.ok(['spec', 'demo'].includes(entry.kind), `${entry.term}: kind is spec or demo`);
    assert.ok(entry.text.length >= 60, `${entry.term}: a definition, not a label`);
    const key = entry.term.toLowerCase();
    assert.ok(!terms.has(key), `${entry.term} appears twice`);
    terms.add(key);
    for (const rule of entry.rules ?? []) assert.ok(ids.has(rule), `${entry.term} cites ${rule}, which the contract does not number`);
  }
  for (const entry of TERMS) {
    for (const see of entry.see ?? []) assert.ok(terms.has(see.toLowerCase()), `${entry.term} points at "${see}", which has no entry`);
  }
  const slugs = TERMS.map(entry => slugOf(entry.term));
  assert.equal(new Set(slugs).size, slugs.length, 'slugs are unique, so every entry has its own anchor');
});

test('the glossary covers the vocabulary: the words STYLE.md says to use as the spec does, every plane, every slot, every outcome', () => {
  const text = TERMS.map(entry => [entry.term, ...(entry.ids ?? []), entry.text].join(' ')).join('\n');
  for (const word of ['assembler', 'producer', 'slot', 'plane', 'item', 'profile', 'trace', 'snapshot', 'route']) {
    assert.ok(TERMS.some(entry => entry.term === word), `an entry for "${word}"`);
  }
  for (const plane of ['governance', 'state', 'evidence', 'interaction']) assert.ok(TERMS.some(entry => entry.term === `${plane} plane`), `an entry for the ${plane} plane`);
  for (const slot of Object.keys(contract.slot_defaults)) assert.ok(text.includes(slot), `${slot} is named`);
  for (const outcome of ['included', 'compressed', 'excluded', 'refused', 'rejected']) assert.ok(text.includes(outcome), `${outcome} is named`);
  assert.ok(TERMS.some(entry => entry.kind === 'demo'), 'the demo has words of its own');
});

test('filterTerms matches the term, its aliases and its text, case-insensitively, and keeps the order', () => {
  const entries = [
    { term: 'plane', kind: 'spec', text: 'Four groups of slots.', aliases: ['planes'] },
    { term: 'slot', kind: 'spec', text: 'One of eleven places an item goes; grouped into planes.' },
    { term: 'talk mode', kind: 'demo', text: 'Larger type for a projector.', aliases: ['projector mode'] },
  ];
  assert.deepEqual(filterTerms(entries, '').map(entry => entry.term), ['plane', 'slot', 'talk mode'], 'no query: everything');
  assert.deepEqual(filterTerms(entries, '  PLANE ').map(entry => entry.term), ['plane', 'slot'], 'the term, and a text that names it');
  assert.deepEqual(filterTerms(entries, 'projector mode').map(entry => entry.term), ['talk mode'], 'an alias');
  assert.deepEqual(filterTerms(entries, 'nothing here'), []);
});

test('reasonEntry reads a code from the contract the page loaded, mapping missing_field:<x> to its registry entry', () => {
  assert.deepEqual(reasonEntry(contract, 'expired'), { code: 'expired', rule: contract.reasons.expired.rule, kind: 'exclusion', text: contract.reasons.expired.text });
  assert.equal(reasonEntry(contract, 'missing_field:freshness').text, contract.reasons['missing_field:<name>'].text);
  assert.equal(reasonEntry(contract, 'missing_field:freshness').code, 'missing_field:freshness', 'the code shown is the one the trace recorded');
  assert.equal(reasonEntry(contract, 'no_such_code'), null);
  assert.equal(reasonEntry(null, 'expired'), null, 'no contract yet: nothing to show');
});

test('renderGlossary gives every entry an anchor, groups spec before demo, escapes, and puts a reason first when asked', () => {
  const entries = [
    { term: 'a <b>', kind: 'spec', text: 'x & y', see: ['talk mode'], rules: ['R-1'] },
    { term: 'talk mode', kind: 'demo', text: 'Larger type.' },
  ];
  const html = renderGlossary(entries);
  assert.match(html, /id="term-a-b"/);
  assert.match(html, /id="term-talk-mode"/);
  assert.match(html, /a &lt;b&gt;/);
  assert.match(html, /x &amp; y/);
  assert.doesNotMatch(html, /<b>/);
  assert.ok(html.indexOf('The spec') < html.indexOf('This demo'), 'the spec\'s words first, then the demo\'s');
  assert.match(html, /data-term="talk-mode"/, 'a see-also link points at the anchor');
  assert.match(html, /R-1/);
  const withReason = renderGlossary(entries, { reason: reasonEntry(contract, 'expired') });
  assert.ok(withReason.indexOf('expired') < withReason.indexOf('id="term-a-b"'), 'the reason card comes first');
  assert.match(withReason, new RegExp(contract.reasons.expired.rule));
  assert.equal(renderGlossary([]), '<p class="hint">no term matches</p>');
});

test('a reason code on the page is a chip that opens the glossary at it: a button carrying data-reason, built by reasonChip wherever a code is drawn', () => {
  assert.equal(reasonChip('expired', 'bad code', 'R-9: gone'), '<button type="button" class="chip bad code" data-reason="expired" title="R-9: gone">expired</button>');
  assert.equal(reasonChip('duplicate_content · producer', 'gray code', '', 'duplicate_content'), '<button type="button" class="chip gray code" data-reason="duplicate_content">duplicate_content · producer</button>', 'the code the chip opens can differ from its text');
  assert.match(reasonChip('a<b', 'bad code', 'x"y'), /data-reason="a&lt;b" title="x&quot;y">a&lt;b</, 'escaped');
  const PUBLIC = path.join(ROOT, 'src', 'inspector', 'public');
  for (const file of ['shared/panels.js', 'shared/delta.js', 'basic/page.js', 'intermediate/page.js', 'advanced/page.js']) {
    const src = readFileSync(path.join(PUBLIC, file), 'utf8');
    assert.doesNotMatch(src, /tag\([^)]*reasonText\(/, `${file}: a chip carrying the registry text is a reason code, and never a plain chip`);
    assert.match(src, /reasonChip\(/, `${file}: reason codes are drawn by reasonChip`);
  }
  const css = readFileSync(path.join(PUBLIC, 'style.css'), 'utf8');
  assert.match(css, /button\.chip\s*{[^}]*height: auto/, 'a chip that is a button keeps the chip\'s size, not the control height');
  assert.match(css, /button\.chip:hover\s*{[^}]*var\(--accent-soft\)/, 'and hovers like a clickable cell');
  const glossary = readFileSync(path.join(PUBLIC, 'shared', 'glossary.js'), 'utf8');
  assert.match(glossary, /closest\('\[data-reason\]'\)/, 'the glossary listens for any element carrying data-reason');
});
