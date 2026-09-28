// The delta strip and the change markers: what changed since the step (or turn) you came from. Pure functions of
// two snapshots and two traces; they compare what the assemblers decided and decide nothing themselves.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { deltaCells, statusChange, stepFacts } from '../src/inspector/public/shared/delta.js';

const trace = {
  refused: { bool: false, reason: null },
  included: [{ slot: 'governance.instructions', item_id: 'p', tokens: 51 }, { slot: 'evidence.knowledge', item_id: 'k', tokens: 30 }],
  compressed: [{ item_id: 'k', from: 66, to: 30, variant_id: 'k~summary', method: 'summarised' }],
  excluded: [{ item_id: 'x', reason: 'expired', stage: 'assembler' }, { item_id: 'm', reason: 'expired', stage: 'producer' }],
  conflicts: [], defaults_filled: [],
  result: { input_tokens: 81, hash: 'abcdef0123456789' },
};
const refused = { ...trace, refused: { bool: true, reason: 'protected_content_over_budget' }, included: [], compressed: [], result: null };
const snapshot = {
  budget: { input: 170, reserved_output: 1200 },
  batches: [
    { items: [{ id: 'p', slot: 'governance.instructions' }, { id: 'k', slot: 'evidence.knowledge' }], excluded: [{ item_id: 'm' }] },
    { items: [{ id: 'o1', slot: 'evidence.tool_results' }, { id: 'o2', slot: 'evidence.tool_results' }], excluded: [] },
    { items: [{ id: 'h1', slot: 'interaction.history' }, { id: 'q', slot: 'interaction.query' }], excluded: [] },
  ],
  conflicts: [{ id: 'g-plan' }],
};

test('stepFacts reduces a snapshot and its trace to the counts the strip compares', () => {
  assert.deepEqual(stepFacts(snapshot, trace), {
    budget: 170, candidates: 6, observations: 2, history: 1, conflicts: 1,
    included: 2, compressed: 1, excluded: 2, tokens: 81, refused: false, codes: ['expired'],
  });
  const facts = stepFacts(snapshot, refused);
  assert.deepEqual([facts.included, facts.compressed, facts.excluded, facts.tokens, facts.refused], [0, 0, 2, null, true]);
  assert.deepEqual(facts.codes, ['expired', 'protected_content_over_budget'], 'the refusal reason counts as a code of this step');
  assert.equal(stepFacts(null, trace), null, 'no snapshot, no facts');
  assert.deepEqual(stepFacts(snapshot, null).included, null, 'a snapshot without a trace has counts for its candidates only');
});

const before = { budget: 600, candidates: 6, observations: 0, history: 2, conflicts: 0, included: 5, compressed: 0, excluded: 1, tokens: 262, refused: false, codes: ['expired'] };
const after = { budget: 170, candidates: 6, observations: 0, history: 2, conflicts: 0, included: 2, compressed: 1, excluded: 2, tokens: 155, refused: false, codes: ['expired', 'over_budget'] };

test('deltaCells compares a step with the one you came from and says which cells changed', () => {
  assert.deepEqual(deltaCells(before, after, 'step'), [
    { label: 'budget.input', before: 600, after: 170, same: false },
    { label: 'candidates', before: 6, after: 6, same: true },
    { label: 'included', before: 5, after: 2, same: false },
    { label: 'compressed', before: 0, after: 1, same: false },
    { label: 'excluded', before: 1, after: 2, same: false, codes: ['over_budget'] },
    { label: 'input tokens', before: 262, after: 155, same: false },
  ]);
});

test('deltaCells shows a refusal as a null result, and declared conflicts only when a side has any', () => {
  const cells = deltaCells(after, { ...after, budget: 60, included: 0, compressed: 0, excluded: 1, tokens: null, refused: true, codes: ['expired', 'protected_content_over_budget'] }, 'step');
  assert.deepEqual(cells.at(-1), { label: 'input tokens', before: 155, after: 'null', same: false });
  assert.deepEqual(cells.find(c => c.label === 'excluded').codes, ['protected_content_over_budget'], 'codes new to this step, the refusal included');
  assert.ok(!cells.some(c => c.label === 'declared conflicts'));
  const withConflicts = deltaCells(before, { ...after, conflicts: 2 }, 'step');
  assert.deepEqual(withConflicts.find(c => c.label === 'declared conflicts'), { label: 'declared conflicts', before: 0, after: 2, same: false });
});

test('deltaCells between turns compares what a tool loop changes: observations and history, not the budget', () => {
  const t4 = { ...after, budget: 1400, candidates: 16, observations: 2, history: 4, included: 16, compressed: 0, excluded: 0, tokens: 524, codes: [] };
  const t5 = { ...t4, candidates: 18, observations: 3, history: 5, included: 17, excluded: 1, tokens: 535, codes: ['superseded'] };
  assert.deepEqual(deltaCells(t4, t5, 'turn').map(c => c.label), ['candidates', 'observations', 'history turns', 'included', 'excluded', 'input tokens']);
  assert.deepEqual(deltaCells(t4, t5, 'turn').find(c => c.label === 'excluded'), { label: 'excluded', before: 0, after: 1, same: false, codes: ['superseded'] });
});

test('statusChange names what a candidate was in the step you came from, or that it is new', () => {
  assert.equal(statusChange({ kind: 'included', tokens: 3 }, { kind: 'excluded', reason: 'over_budget' }, 'step'), 'was included');
  assert.equal(statusChange({ kind: 'compressed', from: 66, to: 30 }, { kind: 'refused' }, 'step'), 'was compressed');
  assert.equal(statusChange({ kind: 'excluded', reason: 'over_budget' }, { kind: 'refused' }, 'step'), 'was over_budget');
  assert.equal(statusChange({ kind: 'included', tokens: 3 }, { kind: 'compressed', from: 66, to: 30 }, 'step'), 'was included');
  assert.equal(statusChange(null, { kind: 'included', tokens: 3 }, 'turn'), 'new this turn', 'absent from the previous snapshot');
  assert.equal(statusChange({ kind: 'included', tokens: 3 }, { kind: 'included', tokens: 3 }, 'step'), null);
  assert.equal(statusChange({ kind: 'excluded', reason: 'expired' }, { kind: 'excluded', reason: 'expired' }, 'step'), null);
  assert.equal(statusChange({ kind: 'excluded', reason: 'expired' }, { kind: 'excluded', reason: 'out_of_scope' }, 'step'), 'was expired');
  assert.equal(statusChange({ kind: 'none' }, { kind: 'included', tokens: 3 }, 'step'), null, 'the previous step had no trace: nothing to say');
});
