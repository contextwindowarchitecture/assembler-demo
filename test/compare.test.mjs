// The comparison the brief and conformance/README.md (Running a case) require: payload bytes byte for byte, traces
// field for field without trace_id, timings and recovery.detail, and the JSON pointer of the first difference.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { agreement, comparable, compareResult, firstDifference } from '../src/harness/compare.mjs';

const trace = (overrides = {}) => ({
  trace_id: 'x', timings: { admission: 1 }, profile: { id: 'p', version: 1 }, budget: { input: 10, reserved_output: 1 },
  result: { input_tokens: 3, hash: 'a'.repeat(64) }, included: [{ slot: 'interaction.query', item_id: 'q', tokens: 3, source_version: '1', eligibility: 'route-policy' }],
  compressed: [], excluded: [], conflicts: [], refused: { bool: false, reason: null },
  context: { spec: 'cwa/draft', assembly_time: '2026-09-22T12:00:00Z', route_policy_version: 'v1', tokenizer: 't', renderer: 'r', snapshot_digest: 'b'.repeat(64) },
  defaults_filled: [], ...overrides,
});

test('comparable removes only trace_id and timings at the top level', () => {
  const stripped = comparable(trace());
  assert.equal('trace_id' in stripped, false);
  assert.equal('timings' in stripped, false);
  assert.deepEqual(Object.keys(stripped).sort(), ['budget', 'compressed', 'conflicts', 'context', 'defaults_filled', 'excluded', 'included', 'profile', 'refused', 'result'].sort());
});

test('comparable removes recovery.detail and keeps recovery.action, without touching the trace it was given', () => {
  const original = trace({ refused: { bool: true, reason: 'evidence_required' }, result: null, recovery: { action: 'request_context', detail: 'ask for the order id' } });
  assert.deepEqual(comparable(original).recovery, { action: 'request_context' });
  assert.equal(original.recovery.detail, 'ask for the order id');
  assert.equal('recovery' in comparable(trace()), false);
});

test('compareResult ignores a difference in recovery.detail but not in recovery.action', () => {
  const refused = recovery => ({ payload: null, trace: trace({ refused: { bool: true, reason: 'evidence_required' }, result: null, recovery }) });
  const expected = refused({ action: 'request_context', detail: 'one wording' });
  const result = detail => ({ outcome: 'refused', ...refused(detail) });
  assert.deepEqual(compareResult(result({ action: 'request_context', detail: 'another wording' }), expected), { outcome: 'passed' });
  assert.deepEqual(compareResult(result({ action: 'request_context' }), expected), { outcome: 'passed' });
  assert.deepEqual(compareResult(result({ action: 'retrieve_narrower', detail: 'one wording' }), expected), { outcome: 'failed', detail: 'trace differs at /recovery/action' });
});

test('firstDifference reports the JSON pointer of the first differing value, or null', () => {
  assert.equal(firstDifference(trace(), trace()), null);
  assert.equal(firstDifference(trace({ result: { input_tokens: 4, hash: 'a'.repeat(64) } }), trace()), '/result/input_tokens');
  assert.equal(firstDifference(trace({ included: [] }), trace()), '/included/0');
  assert.equal(firstDifference(trace({ extra: 1 }), trace()), '/extra');
  assert.equal(firstDifference({ a: [1, 2, 3] }, { a: [1, 2] }), '/a/2');
  assert.equal(firstDifference(1, 2), '/');
});

test('firstDifference visits keys in UTF-16 code unit order, so the first difference is stable', () => {
  // U+1F600 (surrogates D83D DE00) sorts before U+FF5A in UTF-16 code units, and after it in code points
  // (conformance/README.md, Ordering). Code-point order would report /\uFF5A first.
  assert.equal(firstDifference({ '\uFF5A': 1, '\u{1F600}': 1 }, { '\uFF5A': 2, '\u{1F600}': 2 }), '/\u{1F600}');
});

test('compareResult passes only when payload bytes and comparable trace both match', () => {
  const payload = Buffer.from('<query id="q">\nhi\n</query>\n');
  const expected = { payload, trace: trace() };
  const ok = { outcome: 'assembled', payload: Buffer.from(payload), trace: trace({ trace_id: 'other', timings: {} }) };
  assert.deepEqual(compareResult(ok, expected), { outcome: 'passed' });
  assert.deepEqual(compareResult({ ...ok, payload: Buffer.from('other') }, expected), { outcome: 'failed', detail: 'payload bytes differ' });
  assert.deepEqual(compareResult({ ...ok, trace: trace({ defaults_filled: [{ item_id: 'q', field: 'lineage' }] }) }, expected),
    { outcome: 'failed', detail: 'trace differs at /defaults_filled/0' });
});

test('compareResult names a refusal where a payload was expected, and the reverse', () => {
  const payload = Buffer.from('p');
  const refusedTrace = trace({ result: null, included: [], refused: { bool: true, reason: 'required_slot_missing' } });
  assert.deepEqual(compareResult({ outcome: 'refused', payload: null, trace: refusedTrace }, { payload, trace: trace() }),
    { outcome: 'failed', detail: 'refused, but a payload was expected' });
  assert.deepEqual(compareResult({ outcome: 'assembled', payload, trace: trace() }, { payload: null, trace: refusedTrace }),
    { outcome: 'failed', detail: 'a payload, but a refusal was expected' });
  assert.deepEqual(compareResult({ outcome: 'refused', payload: null, trace: refusedTrace }, { payload: null, trace: refusedTrace }), { outcome: 'passed' });
});

test('compareResult skips an unsupported component and fails a rejection or an error', () => {
  const expected = { payload: Buffer.from('p'), trace: trace() };
  assert.deepEqual(compareResult({ outcome: 'unsupported', detail: 'renderer x/v1 is not provided' }, expected), { outcome: 'skipped', detail: 'renderer x/v1 is not provided' });
  assert.deepEqual(compareResult({ outcome: 'rejected', detail: 'budget is required' }, expected), { outcome: 'failed', detail: 'snapshot rejected: budget is required' });
  assert.deepEqual(compareResult({ outcome: 'error', detail: 'exit 1: boom' }, expected), { outcome: 'failed', detail: 'exit 1: boom' });
});

test('compareResult judges a rejection snapshot: rejected passes, anything else fails', () => {
  assert.deepEqual(compareResult({ outcome: 'rejected', detail: 'x' }, { rejection: true }), { outcome: 'rejected' });
  assert.deepEqual(compareResult({ outcome: 'assembled', payload: Buffer.from('p'), trace: trace() }, { rejection: true }),
    { outcome: 'failed', detail: 'assembled a payload instead of rejecting the snapshot' });
  assert.deepEqual(compareResult({ outcome: 'refused', payload: null, trace: trace({ refused: { bool: true, reason: 'evidence_required' } }) }, { rejection: true }),
    { outcome: 'failed', detail: 'refused with evidence_required instead of rejecting the snapshot' });
  assert.deepEqual(compareResult({ outcome: 'unsupported', detail: 'renderer x/v1 is not provided' }, { rejection: true }), { outcome: 'skipped', detail: 'renderer x/v1 is not provided' });
});

test('agreement compares every assembler against the first with a judged result', () => {
  const payload = Buffer.from('p');
  const a = { assembler: 'python', outcome: 'assembled', payload, trace: trace({ trace_id: '1' }) };
  const b = { assembler: 'typescript', outcome: 'assembled', payload: Buffer.from(payload), trace: trace({ trace_id: '2' }) };
  const c = { assembler: 'go', outcome: 'assembled', payload, trace: trace({ result: { input_tokens: 9, hash: 'a'.repeat(64) } }) };
  assert.deepEqual(agreement([a, b]), { agree: true, differences: [] });
  assert.deepEqual(agreement([a, b, c]), { agree: false, differences: [{ assembler: 'go', against: 'python', detail: 'trace differs at /result/input_tokens' }] });
  assert.deepEqual(agreement([{ assembler: 'go', outcome: 'unsupported', detail: 'x' }, a]), { agree: true, differences: [] });
  assert.deepEqual(agreement([a, { assembler: 'go', outcome: 'rejected', detail: 'bad' }]),
    { agree: false, differences: [{ assembler: 'go', against: 'python', detail: 'snapshot rejected: bad' }] });
});
