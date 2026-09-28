// The controller's loop with the model scripted, so the application's own behaviour is checked deterministically:
// tool results enter the next inference as observations, a later observation of the same call supersedes the earlier
// one, an unauthorized request never reaches a server and reaches the model only as task state, a timeout is an
// observation, recovery is bounded, and every inference is recorded with its snapshot and trace.
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { runAgent, validateAnswer } from '../src/agent/controller.mjs';
import { listRuns, loadRun, saveRun } from '../src/agent/store.mjs';

const ANSWER = 'Entitlement\nPro: four business hours [kb:acme:support-plans:v7#1].\n\nIncident\nINC-2041 resolved at 15:52Z.\n\nNext action\nNo ticket needed.';

/** A model that follows a script of turns: each entry is the tool calls to request, or the text to answer with. */
function scripted(script) {
  let turn = 0;
  return async (payload, { maxTokens }) => {
    const step = script[turn++] ?? { text: ANSWER };
    return { request: { max_tokens: maxTokens, payload_length: payload.length }, text: step.text ?? '', tool_calls: step.tool_calls ?? [], model: 'scripted', usage: { input_tokens: 1, output_tokens: 1 }, stop_reason: step.tool_calls ? 'tool_calls' : 'stop', durationMs: 1 };
  };
}
let tick = 0;
const clock = () => `2026-09-28T16:${String(Math.floor(tick / 60)).padStart(2, '0')}:${String(tick++ % 60).padStart(2, '0')}Z`;

test('validateAnswer wants the three headings of the output contract', () => {
  assert.deepEqual(validateAnswer(ANSWER), { ok: true, missing: [] });
  assert.deepEqual(validateAnswer('Incident\nsomething'), { ok: false, missing: ['Entitlement', 'Next action'] });
});

test('a run: observations enter the next turn, a repeated call supersedes, a foreign user is denied, the answer ends it', { timeout: 120_000 }, async () => {
  const answer = scripted([
    { tool_calls: [{ id: 'c1', name: 'get_service_status', arguments: { region: 'eu' } }, { id: 'c2', name: 'get_account', arguments: { user_id: 'u_77' } }] },
    { tool_calls: [{ id: 'c3', name: 'get_service_status', arguments: { region: 'eu' } }, { id: 'c4', name: 'list_tickets', arguments: { user_id: 'u_1042' } }] },
    { text: ANSWER },
  ]);
  const run = await runAgent({ scenarioId: '01-investigate', providerId: 'scripted', assemblerId: 'python', answer, clock, id: 'test-run' });
  assert.equal(run.turns.length, 3);
  assert.deepEqual(run.stop, { reason: 'answer', turn: 3, detail: 'the answer follows the output contract' });
  assert.deepEqual(run.capabilities.granted, ['cap:get_account', 'cap:get_service_status', 'cap:list_tickets']);
  // Every inference has a snapshot, a trace and a digest.
  for (const turn of run.turns) { assert.equal(turn.outcome, 'assembled'); assert.match(turn.trace.context.snapshot_digest, /^[0-9a-f]{64}$/); assert.ok(turn.payload); }
  // Turn 1: the status call ran; the account call for another user never did.
  const [t1, t2, t3] = run.turns;
  assert.deepEqual(t1.tool_requests.map(r => [r.call.name, r.decision, r.executed]), [['get_service_status', 'approved', true], ['get_account', 'denied', false]]);
  assert.equal(run.observations.length, 3, 'status, status again, tickets: the denied call produced no observation');
  assert.ok(run.observations.every(o => o.tool !== 'get_account'));
  assert.deepEqual(run.denials.map(d => d.tool), ['get_account']);
  // Turn 2 sees the first observation, and the denial as task state, not as a tool result.
  const t2task = t2.snapshot.batches.find(b => b.producer.id === 'state-svc').items.find(i => i.slot === 'state.task');
  assert.match(t2task.body, /tool requests denied by the application: get_account\(\{"user_id":"u_77"\}\) because user_id="u_77" is outside/);
  assert.equal(t2.snapshot.batches.find(b => b.producer.id === 'tools-mcp').items.length, 1);
  assert.equal(t2.trace.included.filter(i => i.slot === 'evidence.tool_results').length, 1);
  // Turn 3 sees three observations; the earlier status observation is superseded by the later one of the same call.
  const t3tools = t3.snapshot.batches.find(b => b.producer.id === 'tools-mcp').items;
  assert.equal(t3tools.length, 3);
  const superseded = t3.trace.excluded.filter(row => row.reason === 'superseded');
  assert.deepEqual(superseded.map(row => [row.item_id, row.superseded_by]), [['obs:1:get_service_status', 'obs:2:get_service_status']]);
  assert.equal(JSON.parse(t3tools[1].body).result.state, 'operational', 'the later observation saw the resolution');
  // The model's prior turns are history, never platform messages.
  const t3history = t3.snapshot.batches.find(b => b.producer.id === 'conversation').items.filter(i => i.slot === 'interaction.history');
  assert.equal(t3history.length, 2);
  assert.match(t3history[0].body, /\[tool request\] get_service_status\(\{"region":"eu"\}\)/);
  assert.equal(JSON.parse(t3.payload).messages.length, 1);
  assert.equal(run.answer, ANSWER);
  assert.ok(run.memory_proposal.body.includes('INC-2041'));
});

test('the reinforced route places the instructions twice, evidence ahead of state, and compresses evidence under its budget', { timeout: 120_000 }, async () => {
  const answer = scripted([
    { tool_calls: [{ id: 'c1', name: 'get_account', arguments: { user_id: 'u_1042' } }] },
    { tool_calls: [{ id: 'c2', name: 'get_service_status', arguments: { region: 'eu' } }] },
    { tool_calls: [{ id: 'c3', name: 'list_tickets', arguments: { user_id: 'u_1042' } }] },
    { text: ANSWER },
  ]);
  const run = await runAgent({ scenarioId: '01-investigate', routeId: 'incident-agent-reinforced', providerId: 'scripted', assemblerId: 'python', answer, clock, id: 'test-reinforced' });
  assert.equal(run.route.id, 'incident-agent-reinforced');
  assert.equal(run.route.profile, 'incident-agent-reinforced-messages');
  const last = run.turns.at(-1);
  assert.equal(last.trace.context.route_policy_version, 'incident-agent-reinforced/v1');
  const slots = last.trace.included.map(row => row.slot);
  assert.equal(slots.filter(s => s === 'governance.instructions').length, 2, 'the instructions are placed twice and counted twice');
  assert.ok(slots.indexOf('evidence.knowledge') < slots.indexOf('state.user'), 'evidence comes before the user profile');
  assert.equal(slots.at(-1), 'interaction.query');
  assert.equal(slots.at(-2), 'governance.instructions', 'the restated instructions sit right before the query');
  const ir = JSON.parse(last.payload);
  assert.equal(ir.system.length, 1);
  assert.match(ir.messages[0].content, /<instructions id="policy:incident-agent:v1">[\s\S]*<query id=/);
  // Under the route's tighter budget, the evidence chunks take their summaries once observations accumulate, and
  // every observation stays: nothing protected moves, and no tool result is shed.
  assert.equal(last.snapshot.budget.input, 620);
  assert.ok(last.trace.compressed.length >= 1, `evidence is compressed: ${JSON.stringify(last.trace.compressed)}`);
  assert.ok(last.trace.compressed.every(row => row.slot === 'evidence.knowledge'));
  assert.equal(last.trace.included.filter(r => r.slot === 'evidence.tool_results').length, 3, 'every observation is still included');
  assert.equal(run.turns[0].trace.compressed.length, 0, 'the first inference fits without compression');
});

test('a timeout is an observation; a later success supersedes it; recovery and turns are bounded', { timeout: 120_000 }, async () => {
  const answer = scripted([
    { tool_calls: [{ id: 'c1', name: 'get_service_status', arguments: { region: 'eu' } }] },
    { tool_calls: [{ id: 'c2', name: 'get_service_status', arguments: { region: 'eu' } }] },
    { text: ANSWER },
  ]);
  const run = await runAgent({ scenarioId: '02-timeout', providerId: 'scripted', assemblerId: 'python', answer, clock, id: 'test-timeout', faults: { status: ['timeout'] } });
  const [first, second] = run.observations;
  assert.equal(first.ok, false);
  assert.match(first.error, /timeout after 2000 ms/);
  assert.equal(second.ok, true);
  const t3 = run.turns[2];
  assert.match(t3.snapshot.batches.find(b => b.producer.id === 'state-svc').items[1].body, /tool calls that failed: get_service_status/);
  assert.deepEqual(t3.trace.excluded.filter(r => r.reason === 'superseded').map(r => r.item_id), ['obs:1:get_service_status'], 'the failure is superseded by the success of the same call');
  assert.equal(run.stop.reason, 'answer');
});

test('on the last turn no tool is offered, so a model that keeps requesting tools is stopped with what it wrote', { timeout: 120_000 }, async () => {
  const answer = scripted(Array.from({ length: 9 }, () => ({ tool_calls: [{ id: 'c', name: 'list_tickets', arguments: { user_id: 'u_1042' } }] })));
  const run = await runAgent({ scenarioId: '01-investigate', providerId: 'scripted', assemblerId: 'python', answer, clock, id: 'test-max' });
  assert.equal(run.turns.length, run.limits.max_turns);
  const last = run.turns.at(-1);
  assert.equal(last.snapshot.batches.find(b => b.producer.id === 'capability-policy').items.length, 0, 'no tool is offered on the last turn');
  assert.deepEqual(last.snapshot.capabilities.allowed_ids, []);
  assert.equal(JSON.parse(last.payload).tools.length, 0);
  assert.match(last.snapshot.batches.find(b => b.producer.id === 'state-svc').items[1].body, /the last: no tool is offered/);
  assert.deepEqual(last.tool_requests.map(r => [r.decision, r.executed]), [['denied', false]]);
  assert.equal(run.observations.length, run.limits.max_turns - 1, 'every earlier turn executed its call; the last could not');
  assert.equal(run.stop.reason, 'no_answer', 'a scripted model that wrote nothing gets a clear stop, not an answer');
  assert.match(run.stop.detail, /asked for list_tickets, which was not offered; it was the last turn/);
});

test('the store saves, lists and loads runs', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cwa-runs-'));
  const run = { id: 'reference-x', scenario: '01-investigate', title: 't', started: '2026-09-28T16:00:00Z', provider: 'local', model: 'm', assembler: 'python', turns: [{ n: 1 }], stop: { reason: 'answer', turn: 1 }, reference: true };
  await saveRun(run, { dir });
  assert.deepEqual(await listRuns({ dir }), [{ id: 'reference-x', scenario: '01-investigate', route: 'incident-agent', title: 't', started: '2026-09-28T16:00:00Z', provider: 'local', model: 'm', assembler: 'python', turns: 1, stop: { reason: 'answer', turn: 1 }, reference: true }]);
  assert.equal((await loadRun('reference-x', { dir })).turns.length, 1);
  assert.equal(await loadRun('nope', { dir }), null);
});
