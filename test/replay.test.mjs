// The reference runs were recorded against a real model. Replay feeds every recorded snapshot through every
// available assembler and judges each against the trace recorded at the time: the pass criteria of the advanced
// stage, checked offline. Also the invariants every recorded run must hold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadRun, listRuns } from '../src/agent/store.mjs';
import { loadAssemblers, runAll, select } from '../src/harness/adapters.mjs';
import { agreement, compareResult } from '../src/harness/compare.mjs';

const references = (await listRuns()).filter(r => r.reference);
const assemblers = select(await loadAssemblers(), []);

test('there is a reference run for each advanced scenario, and one for the second route', () => {
  assert.deepEqual(references.map(r => `${r.scenario}@${r.route}`).sort(), ['01-investigate@incident-agent', '01-investigate@incident-agent-reinforced', '02-timeout@incident-agent']);
});

for (const summary of references) {
  test(`${summary.id}: every inference has a snapshot and a trace, unauthorized calls never executed, the loop terminated`, async () => {
    const run = await loadRun(summary.id);
    assert.ok(run.turns.length >= 1 && run.turns.length <= run.limits.max_turns);
    assert.ok(['answer', 'refused', 'max_turns', 'no_answer'].includes(run.stop.reason), run.stop.reason);
    for (const turn of run.turns) {
      assert.ok(turn.snapshot, `turn ${turn.n} has a snapshot`);
      if (turn.outcome === 'assembled' || turn.outcome === 'refused') assert.match(turn.trace.context.snapshot_digest, /^[0-9a-f]{64}$/);
      for (const request of turn.tool_requests) {
        if (request.decision !== 'approved') assert.equal(request.executed, false, `${request.call.name} was denied and must not run`);
      }
    }
    for (const observation of run.observations) assert.ok(run.capabilities.granted.some(id => id === `cap:${observation.tool}`), `${observation.tool} was granted`);
    if (run.turns.length > 1) {
      const last = run.turns.at(-1);
      const reached = last.snapshot.batches.find(b => b.producer.id === 'tools-mcp').items.length;
      assert.equal(reached, run.observations.filter(o => o.turn < last.n).length, 'every earlier observation reaches the last inference through the context boundary');
    }
  });

  test(`${summary.id}: replay through every available assembler matches the recorded traces and agrees`, { timeout: 120_000 }, async () => {
    const run = await loadRun(summary.id);
    for (const turn of run.turns) {
      if (!turn.trace) continue;
      const results = await runAll(assemblers, Buffer.from(JSON.stringify(turn.snapshot, null, 2) + '\n', 'utf8'));
      const expected = { payload: turn.payload === null ? null : Buffer.from(turn.payload, 'utf8'), trace: turn.trace };
      for (const result of results) {
        const judged = compareResult(result, expected);
        assert.equal(judged.outcome, 'passed', `turn ${turn.n} ${result.assembler}: ${judged.detail}`);
      }
      assert.equal(agreement(results).agree, true, `turn ${turn.n}`);
    }
  });
}
