// The application controller: bounded turns around the assembler. Each turn collects context from the producers,
// freezes a snapshot, assembles it, sends the payload to the model, and either takes the answer or authorizes and
// executes the tool requests, whose observations enter the next turn's context. Refusals go to a bounded recovery.
// The model never executes anything: the guard decides, the MCP client calls, and a denial reaches the model only
// as task state. Every inference is recorded for replay.
import { randomUUID } from 'node:crypto';
import { loadAssemblers, runAdapter } from '../harness/adapters.mjs';
import { answer as defaultAnswer } from '../provider/index.mjs';
import { grantTools, loadSource } from './capabilities.mjs';
import { authorize } from './guard.mjs';
import { connectServers } from './mcp.mjs';
import { conversationBatch, freezeTurn, observationSource, policyBatch, retrieveBatch, stateBatch, toolsBatch } from './producers.mjs';

const HEADINGS = ['Entitlement', 'Incident', 'Next action'];

/** What the output contract asks for, checked outside the model: the three headings, and something after each. */
export function validateAnswer(text) {
  const missing = HEADINGS.filter(heading => !new RegExp(`(^|\\n)\\W*${heading}\\b`, 'i').test(text ?? ''));
  return { ok: missing.length === 0 && (text ?? '').trim().length > 0, missing };
}

export async function runAgent({
  scenarioId, providerId = 'local', assemblerId = 'python', faults, id, reference = false,
  clock = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), answer = defaultAnswer, env = process.env, onTurn = () => {},
} = {}) {
  const scenario = loadSource('scenarios.json').find(s => s.id === scenarioId);
  if (!scenario) throw new Error(`no advanced scenario ${scenarioId}`);
  const common = loadSource('common.json');
  const { scope, budget, controller: limits } = common;
  const account = loadSource('services/accounts.json')[scope.user];
  const assemblers = await loadAssemblers();
  const assembler = assemblers[assemblerId];
  if (!assembler?.available) throw new Error(`assembler ${assemblerId} is not available`);

  const run = {
    id: id ?? `${reference ? 'reference' : 'live'}-${scenarioId}${reference ? '' : `-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`}`,
    scenario: scenarioId, title: scenario.title, question: scenario.question, reference,
    started: clock(), provider: providerId, model: null, assembler: assemblerId, faults: { ...scenario.faults, ...(faults ?? {}) },
    limits, turns: [], observations: [], denials: [], answer: null, validation: null, stop: null, memory_proposal: null,
  };
  const mcp = await connectServers({ faults: run.faults });
  try {
    const grant = grantTools(loadSource('capabilities.json'), mcp.proposed, { now: run.started });
    run.capabilities = { proposed: mcp.proposed.map(t => `${t.server}/${t.name}`), granted: grant.grant.allowed_ids, not_granted: grant.notGranted, missing: grant.missing };
    const kb = await retrieveBatch(common.retrieval);
    run.retrieval = kb.report;
    const modelTurns = [];
    const task = { turn: 0, maxTurns: limits.max_turns, denied: [], failed: [], recoveries: 0, maxRecoveries: limits.max_recoveries };
    for (let n = 1; n <= limits.max_turns; n++) {
      task.turn = n;
      const now = clock();
      const batches = [policyBatch(now), { producer: { id: 'capability-policy', kind: 'capability_policy' }, items: grant.items, excluded: [] },
        stateBatch({ scope, account, now, task }), kb.batch, toolsBatch(run.observations, scope), conversationBatch({ scope, question: scenario.question, questionAt: run.started, modelTurns })];
      const snapshot = freezeTurn({ now, scope, budget, tokenizer: common.tokenizer, renderers: common.renderers, batches, grant: grant.grant });
      const result = await runAdapter(assembler, Buffer.from(JSON.stringify(snapshot, null, 2) + '\n', 'utf8'));
      const turn = { n, at: now, snapshot, outcome: result.outcome, trace: result.trace ?? null, payload: result.payload ? result.payload.toString('utf8') : null, detail: result.detail ?? null, tool_requests: [], request: null, response: null, recovery: null };
      run.turns.push(turn);
      if (result.outcome !== 'assembled' && result.outcome !== 'refused') { run.stop = { reason: `snapshot_${result.outcome}`, turn: n, detail: result.detail }; onTurn(turn); break; }
      if (result.outcome === 'refused') {
        const reason = result.trace.refused.reason, recovery = result.trace.recovery ?? null;
        if (task.recoveries < limits.max_recoveries) {
          task.recoveries++;
          turn.recovery = { attempted: true, reason, action: recovery?.action ?? null, note: 'the controller records the refusal in the task state and tries once more with whatever the producers have now' };
          onTurn(turn);
          continue;
        }
        run.stop = { reason: 'refused', turn: n, detail: `${reason}${recovery ? ` (recovery ${recovery.action})` : ''}: no recovery left, no request sent` };
        onTurn(turn);
        break;
      }
      let response;
      try {
        response = await answer(turn.payload, { provider: providerId, maxTokens: budget.reserved_output, env });
      } catch (error) {
        run.stop = { reason: 'provider_error', turn: n, detail: error.message };
        onTurn(turn);
        break;
      }
      run.model = response.model ?? run.model;
      turn.request = response.request;
      turn.response = { text: response.text ?? '', tool_calls: response.tool_calls ?? [], model: response.model, usage: response.usage ?? null, stop_reason: response.stop_reason ?? null, durationMs: response.durationMs ?? null, reasoning: response.reasoning ?? null };
      if (!turn.response.tool_calls.length) {
        run.answer = turn.response.text;
        run.validation = validateAnswer(run.answer);
        run.stop = { reason: 'answer', turn: n, detail: run.validation.ok ? 'the answer follows the output contract' : `the answer misses ${run.validation.missing.join(', ')}` };
        run.memory_proposal = { body: `On ${now.slice(0, 10)} the user investigated ${run.observations.find(o => o.ok && o.value?.incident)?.value?.incident ?? 'an incident'} in region ${account.region}; the assistant drafted the next action.`, source: `turn:${scope.session}#1`, note: 'proposed to the memory store after the answer was validated; not written by the demo' };
        onTurn(turn);
        break;
      }
      for (const call of turn.response.tool_calls) {
        const decision = authorize(call, { granted: grant.granted, proposed: mcp.proposed, scope, account });
        const request = { call, decision: decision.decision, reason: decision.reason, cap: decision.cap ?? null, executed: false, observation: null, ms: null };
        turn.tool_requests.push(request);
        if (decision.decision !== 'approved') { run.denials.push({ turn: n, tool: call.name, arguments: call.arguments, reason: decision.reason }); task.denied.push({ tool: call.name, arguments: call.arguments, reason: decision.reason }); continue; }
        const cap = grant.granted[decision.cap];
        const outcome = await mcp.call(cap.server, cap.tool, call.arguments, { timeoutMs: limits.tool_timeout_ms });
        const observation = { n: run.observations.length + 1, turn: n, server: cap.server, tool: cap.tool, arguments: call.arguments, source: observationSource(cap.server, cap.tool, call.arguments), observedAt: clock(), ok: outcome.ok, value: outcome.ok ? outcome.value : null, error: outcome.ok ? null : outcome.error, ms: outcome.ms };
        run.observations.push(observation);
        request.executed = true; request.observation = observation.n; request.ms = outcome.ms;
        if (!outcome.ok) task.failed.push({ tool: cap.tool, arguments: call.arguments, error: outcome.error });
      }
      modelTurns.push({ at: now, text: turn.response.text, tool_calls: turn.response.tool_calls });
      onTurn(turn);
    }
    if (!run.stop) run.stop = { reason: 'max_turns', turn: limits.max_turns, detail: `${limits.max_turns} turns without an answer: the controller stopped` };
  } finally {
    await mcp.close();
  }
  run.finished = clock();
  return run;
}
