// The advanced stage's producers, run by the controller before every inference: the policy registry, the account
// state and the task state the controller writes, the retrieval batch (LlamaIndex, run once per run), every
// observation the tools produced so far, and the conversation: the live question plus the model's prior turns as
// history, never as platform messages (R-7). freezeTurn composes the snapshot for one inference.
import { spawn } from 'node:child_process';
import { ROOT } from '../harness/adapters.mjs';
import { loadSource } from './capabilities.mjs';

const item = fields => ({ token_budget: null, variants: [], conflict_policy: 'defers', lineage: 'verbatim', eligibility: 'route-policy', injection_risk: 'untrusted_content', ...fields });

export function policyBatch(now) {
  const policy = loadSource('policy.json');
  const make = (entry, slot) => item({ id: entry.id, slot, source: entry.source, source_version: entry.source_version, authority: 'governing', trust: 'verified',
    freshness: entry.freshness, conflict_policy: entry.conflict_policy, injection_risk: 'none', body: entry.body });
  return { producer: { id: 'policy-registry', kind: 'policy' }, items: [...policy.instructions.map(e => make(e, 'governance.instructions')), ...policy.output_contract.map(e => make(e, 'governance.output_contract'))], excluded: [] };
}

/** The account row, observed now, and the controller's task state: turn, denials, failures and recoveries. */
export function stateBatch({ scope, account, now, task }) {
  const items = [
    item({ id: `user:${scope.user}:account`, slot: 'state.user', source: 'accounts-db:workspaces', source_version: now, authority: 'state', trust: 'verified', freshness: now,
      scope: { tenant: scope.tenant, user: scope.user }, conflict_policy: 'governs', lineage: 'extracted', injection_risk: 'none',
      eligibility: 'incident-agent/v1: tenant and user of the request; observed within 300 s',
      body: `plan=${account.plan}; seats=${account.seats}; region=${account.region}; renewal=${account.renewal}` }),
    item({ id: `task:${scope.task}`, slot: 'state.task', source: 'controller:task', source_version: String(task.turn), authority: 'state', trust: 'verified', freshness: now,
      scope: { tenant: scope.tenant, task: scope.task }, conflict_policy: 'governs', lineage: 'extracted', injection_risk: 'none',
      eligibility: 'incident-agent/v1: tenant and task of the request; written by the controller this turn',
      body: [`task=${scope.task}`, `turn=${task.turn} of ${task.maxTurns}`,
        task.denied.length ? `tool requests denied by the application: ${task.denied.map(d => `${d.tool}(${JSON.stringify(d.arguments)}) because ${d.reason}`).join(' | ')}` : 'tool requests denied: none',
        task.failed.length ? `tool calls that failed: ${task.failed.map(f => `${f.tool}(${JSON.stringify(f.arguments)}): ${f.error}`).join(' | ')}` : 'tool calls that failed: none',
        `recoveries used=${task.recoveries} of ${task.maxRecoveries}`].join('; ') }),
  ];
  return { producer: { id: 'state-svc', kind: 'state' }, items, excluded: [] };
}

/** The retrieval batch from the intermediate stage's LlamaIndex producer, via its retrieve entry point. */
export function retrieveBatch({ query, top_k }, { root = ROOT } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('uv', ['run', '--quiet', '--directory', 'producers', 'python', '-m', 'producers.retrieve', '--query', query, '--top-k', String(top_k)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [], err = [];
    child.stdout.on('data', c => out.push(c)); child.stderr.on('data', c => err.push(c));
    child.on('error', error => reject(new Error(`cannot run the retrieval producer: ${error.message}`)));
    child.on('close', code => {
      if (code !== 0) return reject(new Error(`the retrieval producer exited ${code}: ${Buffer.concat(err).toString('utf8').trim()}`));
      try { resolve(JSON.parse(Buffer.concat(out).toString('utf8'))); } catch { reject(new Error('the retrieval producer did not print JSON')); }
    });
  });
}

/** One source string per tool and arguments, so a later observation of the same call supersedes an earlier one. */
export const observationSource = (server, tool, args) => `mcp:${server}/${tool}?${Object.keys(args).sort().map(k => `${k}=${JSON.stringify(args[k])}`).join('&')}`;

/** Every observation so far, each an evidence.tool_results item: a result, or the failure the call produced. */
export function toolsBatch(observations, scope) {
  return {
    producer: { id: 'tools-mcp', kind: 'mcp' },
    items: observations.map(obs => item({ id: `obs:${obs.n}:${obs.tool}`, slot: 'evidence.tool_results', source: obs.source, source_version: String(obs.n),
      authority: 'observation', trust: 'unverified', freshness: obs.observedAt, scope: { tenant: scope.tenant }, conflict_policy: 'governs',
      eligibility: 'incident-agent/v1: an approved tool call this session; observed within 3600 s',
      body: JSON.stringify(obs.ok ? { tool: obs.tool, arguments: obs.arguments, observed_at: obs.observedAt, result: obs.value } : { tool: obs.tool, arguments: obs.arguments, observed_at: obs.observedAt, error: obs.error }) })),
    excluded: [],
  };
}

/** The live question as the query, and the model's prior turns as history with lineage generated (R-7). */
export function conversationBatch({ scope, question, questionAt, modelTurns }) {
  const items = [item({ id: `turn:${scope.session}#1`, slot: 'interaction.query', source: `conversation:${scope.session}#1`, source_version: '1', authority: 'user', trust: 'unverified', freshness: questionAt, body: question })];
  modelTurns.forEach((turn, index) => {
    const lines = [];
    if (turn.text) lines.push(turn.text);
    for (const call of turn.tool_calls ?? []) lines.push(`[tool request] ${call.name}(${JSON.stringify(call.arguments)})`);
    items.push(item({ id: `turn:${scope.session}#${index + 2}`, slot: 'interaction.history', source: `conversation:${scope.session}#${index + 2}`, source_version: '1', authority: 'untrusted', trust: 'unverified',
      freshness: turn.at, lineage: 'generated', body: lines.join('\n') || '(no text)' }));
  });
  return { producer: { id: 'conversation', kind: 'interaction' }, items, excluded: [] };
}

/** The snapshot for one inference, in the messages rendering the model sees, or the fixture one for comparison. */
export function freezeTurn({ variant = 'messages', now, scope, budget, tokenizer, renderers, batches, grant, conflicts = [] }) {
  const profiles = loadSource('profiles.json');
  return {
    assembly_time: now, scope, budget, profile: profiles[variant], route_policy: loadSource('route-policy.json'),
    tokenizer, renderer: renderers[variant], batches, capabilities: grant, conflicts,
  };
}
