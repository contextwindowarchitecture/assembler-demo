// The advanced stage: a recorded run of the controller, inference by inference. The timeline shows each turn's
// outcome, the model's response and every tool request with the guard's decision; selecting a turn shows its
// snapshot, trace, payload and recorded response in the shared columns. "Run live" records a new run against a real
// model; "Replay" feeds every recorded snapshot through all three assemblers.
import { $, api, esc, postJson, reasonTextFor, stageNav, tag } from '../shared/format.js';
import { loadSnippets, renderAnswer, renderCandidates, renderDecisions, renderRequest } from '../shared/panels.js';

const STAGE = 'advanced';

const page = {
  api,
  reasonText: () => '',
  recordedAnswer: () => {
    const turn = currentTurn();
    if (!turn?.response) return null;
    return { label: `turn ${turn.n} · ${state.run.provider}`, ...turn.response, request: turn.request };
  },
  state: {
    runs: [], run: null, turn: 1, scenarios: [], routes: [], providers: [], assemblers: [], contract: null,
    variant: 'messages', response: null, busy: null, error: null, replay: null,
    snippets: null, snippetLang: 'typescript', snippetTab: 'anthropic',
  },
};
const { state } = page;
const currentTurn = () => state.run?.turns.find(t => t.n === state.turn) ?? null;

/** The shape the shared columns read: the turn's snapshot and its recorded assembly as the one result. */
function responseFor(turn) {
  if (!turn) return null;
  return {
    snapshot: turn.snapshot, derived: false,
    results: [{ assembler: state.run.assembler, outcome: turn.outcome, payload: turn.payload, trace: turn.trace, detail: turn.detail, durationMs: 0 }],
    agreement: { agree: true, differences: [] }, expectation: null,
  };
}

async function selectRun(id) {
  state.busy = 'loading'; state.replay = null; render();
  try { state.run = await api(`/api/agent/runs/${encodeURIComponent(id)}`); state.turn = 1; state.error = null; }
  catch (error) { state.error = error.message; state.run = null; }
  state.busy = null;
  location.hash = id;
  if ($('#run')) $('#run').value = id;
  await selectTurn(1);
}

async function selectTurn(n) {
  state.turn = n;
  state.response = responseFor(currentTurn());
  state.snippets = null;
  render();
  const result = state.response?.results[0];
  if (result?.outcome === 'assembled') await loadSnippets(page, result);
}

function render() {
  renderHead(); renderRoutes(); renderTimeline(); renderBadges();
  const result = state.response?.results[0] ?? null;
  renderCandidates(page, result); renderDecisions(page, result); renderRequest(page, result); renderAnswer(page, result); renderFoot();
}

function renderHead() {
  const run = state.run;
  if (!run) { $('#scenario-head').innerHTML = state.error ? `<div class="outcome bad">${esc(state.error)}</div>` : '<p class="hint">no recorded run yet: run one live</p>'; return; }
  const scenario = state.scenarios.find(s => s.id === run.scenario) ?? {};
  $('#scenario-head').innerHTML = `
    <div>
      <h1>${esc(run.title)}</h1>
      <p class="question">“${esc(run.question)}”</p>
      <p>${esc(scenario.description ?? '')}</p>
      <p class="proves"><strong>Proves:</strong> ${esc(scenario.proves ?? '')} ${(scenario.look_for ?? []).map(code => tag(code, 'reason', page.reasonText(code))).join(' ')}</p>
      <p class="hint">granted: ${run.capabilities.granted.map(id => `<span class="mono">${esc(id)}</span>`).join(', ')} · proposed but not granted: ${run.capabilities.not_granted.map(t => `<span class="mono">${esc(t.tool)}</span> (${esc(t.why)})`).join(', ') || 'none'}${Object.keys(run.faults ?? {}).length ? ` · injected faults: <span class="mono">${esc(JSON.stringify(run.faults))}</span>` : ''}</p>
    </div>
    <div class="meta">
      <span>${run.reference ? 'reference run' : 'live run'} · ${esc(run.started)}</span>
      <span>route <span class="mono">${esc(run.route?.id ?? 'incident-agent')}</span> · profile <span class="mono">${esc(run.route?.profile ?? '')}</span></span>
      <span>model <span class="mono">${esc(run.model ?? '?')}</span> via ${esc(run.provider)} · assembled by ${esc(run.assembler)}</span>
      <span>stop: <span class="mono">${esc(run.stop.reason)}</span> at turn ${run.stop.turn} · ${esc(run.stop.detail)}</span>
      <span>${run.observations.length} observations · ${run.denials.length} denied request${run.denials.length === 1 ? '' : 's'}${run.validation ? ` · answer ${run.validation.ok ? 'follows' : 'misses part of'} the output contract` : ''}</span>
      ${run.memory_proposal ? `<span title="${esc(run.memory_proposal.note)}">memory proposed: <span class="mono">${esc(run.memory_proposal.body)}</span></span>` : ''}
    </div>`;
}

/** Both routes side by side: placement order, the rules that differ, and the recorded runs of each. */
function renderRoutes() {
  const routes = state.routes;
  if (!routes.length) { $('#routes').innerHTML = ''; return; }
  $('#routes').innerHTML = `<details ${state.run ? '' : 'open'}><summary>Routes: two placement profiles for the same tools and guard, compared independently</summary>
    <div class="route-cards">${routes.map(route => {
      const runs = state.runs.filter(r => r.route === route.id);
      const active = state.run?.route?.id === route.id;
      return `<div class="route-card ${active ? 'active' : ''}">
        <div class="producer-head"><strong>${esc(route.title)}</strong><span class="kind">${esc(route.policy_version)}</span><span class="kind">provider ${esc(route.provider)}</span></div>
        <p class="hint">${esc(route.summary)}</p>
        <div class="section-label">placement (messages profile)</div>
        <ol class="pipeline">${route.placement.map(p => `<li><span class="mono">${esc(p.slot)}</span> as <span class="mono">${esc(p.wrap)}</span></li>`).join('')}</ol>
        ${route.differences.length ? `<div class="section-label">what differs</div><ul class="pipeline">${route.differences.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        <div class="section-label">recorded runs</div>
        ${runs.length ? runs.map(r => `<div><a href="#${esc(r.id)}" data-run="${esc(r.id)}" class="run-link">${esc(r.id)}</a> · ${r.turns} turns · ${esc(r.stop.reason)}</div>`).join('') : '<p class="hint">none yet</p>'}
      </div>`;
    }).join('')}</div></details>`;
  $('#routes').querySelectorAll('a.run-link').forEach(a => a.addEventListener('click', event => { event.preventDefault(); selectRun(a.dataset.run); }));
}

function renderTimeline() {
  const run = state.run;
  if (!run) { $('#timeline').innerHTML = ''; return; }
  const replay = state.replay;
  $('#timeline').innerHTML = `<div class="turns">${run.turns.map(turn => {
    const rp = replay?.turns.find(t => t.n === turn.n);
    const requests = turn.tool_requests.map(r => `<div class="tags">${tag(r.decision, r.decision === 'approved' ? 'status-included' : 'reason', r.reason)}<span class="mono">${esc(r.call.name)}(${esc(JSON.stringify(r.call.arguments))})</span>${r.executed ? tag(`observation ${r.observation} · ${r.ms} ms`, 'status-compressed') : ''}</div>`).join('');
    const outcome = turn.outcome === 'assembled' ? tag(`assembled · ${turn.trace.result.input_tokens} tokens`, 'status-included') : turn.outcome === 'refused' ? tag(`refused · ${turn.trace.refused.reason}`, 'reason') : tag(turn.outcome, 'reason');
    const response = turn.response ? (turn.response.tool_calls.length ? `<div class="hint">${turn.response.tool_calls.length} tool request${turn.response.tool_calls.length === 1 ? '' : 's'} · ${turn.response.durationMs} ms</div>` : `<div class="hint">answer · ${turn.response.durationMs} ms</div>`) : turn.recovery ? `<div class="hint">recovery: ${esc(turn.recovery.action ?? 'none')}</div>` : '<div class="hint">no model call</div>';
    const badge = rp ? (rp.agreement.agree && rp.results.every(r => r.outcome === 'passed') ? tag(`replay: ${rp.results.length} agree, match recorded`, 'status-included') : tag('replay: DIFFERS', 'reason', rp.results.map(r => `${r.assembler}: ${r.outcome} ${r.detail ?? ''}`).join('\n'))) : '';
    return `<button type="button" class="turn ${turn.n === state.turn ? 'active' : ''}" data-n="${turn.n}">
      <div class="turn-head"><strong>Turn ${turn.n}</strong> <span class="hint">${esc(turn.at)}</span></div>
      <div class="tags">${outcome}${badge}</div>${response}${requests}
      <div class="hint mono">digest ${esc(turn.trace?.context.snapshot_digest.slice(0, 12) ?? '—')}…</div>
    </button>`;
  }).join('')}</div>`;
  $('#timeline').querySelectorAll('button.turn').forEach(button => button.addEventListener('click', () => selectTurn(Number(button.dataset.n))));
}

function renderBadges() {
  const badges = [];
  if (state.busy === 'running') badges.push('<span class="badge">running the controller against the model…</span>');
  else if (state.busy === 'replaying') badges.push('<span class="badge">replaying every inference through all three…</span>');
  else if (state.busy) badges.push(`<span class="badge">${esc(state.busy)}…</span>`);
  else if (state.replay) {
    const ok = state.replay.turns.every(t => t.agreement.agree && t.results.every(r => r.outcome === 'passed'));
    badges.push(ok ? `<span class="badge ok">${state.replay.turns.length} inferences replayed: all three agree and match the recorded traces</span>` : '<span class="badge bad">replay differs from the record</span>');
  }
  if (state.error) badges.push(`<span class="badge bad">${esc(state.error)}</span>`);
  $('#agreement').outerHTML = `<span id="agreement">${badges.join(' ')}</span>`;
}

function renderFoot() {
  const parts = state.assemblers.map(a => `${a.language}: ${a.available ? 'available' : 'not built'}`);
  $('#foot').textContent = `${parts.join(' · ')} · ${state.runs.length} recorded run${state.runs.length === 1 ? '' : 's'}`;
}

async function init() {
  $('#stages').innerHTML = stageNav(STAGE);
  const [st, contract, scenarios, runs, routes] = await Promise.all([api('/api/state'), api('/api/contract'), api('/api/agent/scenarios'), api('/api/agent/runs'), api('/api/agent/routes')]);
  Object.assign(state, { providers: st.providers, assemblers: st.assemblers, contract, scenarios, runs, routes });
  $('#route').innerHTML = routes.map(r => `<option value="${esc(r.id)}">${esc(r.title)} · ${esc(r.provider)}</option>`).join('');
  $('#route').addEventListener('change', () => { const route = routes.find(r => r.id === $('#route').value); if (route) $('#provider').value = route.provider; });
  page.reasonText = reasonTextFor(contract);
  const configured = st.providers.filter(p => p.configured);
  $('#provider').innerHTML = st.providers.map(p => `<option value="${esc(p.id)}"${p.configured ? '' : ' disabled'}>${esc(p.label)} · ${esc(p.model ?? 'not configured')}</option>`).join('');
  $('#start').disabled = configured.length === 0;
  $('#scenario').innerHTML = scenarios.map(s => `<option value="${esc(s.id)}">${esc(s.id)} · ${esc(s.title)}</option>`).join('');
  const fillRuns = () => { $('#run').innerHTML = state.runs.map(r => `<option value="${esc(r.id)}"${r.id === state.run?.id ? ' selected' : ''}>${esc(r.id)} · ${esc(r.route)} · ${r.turns} turns · ${esc(r.stop.reason)}</option>`).join('') || '<option value="">none yet</option>'; };
  fillRuns();
  $('#run').addEventListener('change', event => selectRun(event.target.value));
  $('#start').addEventListener('click', async () => {
    state.busy = 'running'; state.error = null; render();
    try {
      const run = await postJson('/api/agent/run', { scenario: $('#scenario').value, route: $('#route').value, provider: $('#provider').value });
      state.runs = await api('/api/agent/runs'); fillRuns();
      state.busy = null;
      await selectRun(run.id);
    } catch (error) { state.busy = null; state.error = error.message; render(); }
  });
  $('#replay').addEventListener('click', async () => {
    if (!state.run) return;
    state.busy = 'replaying'; render();
    try { state.replay = await postJson('/api/agent/replay', { run: state.run.id }); } catch (error) { state.error = error.message; }
    state.busy = null; render();
  });
  const wanted = decodeURIComponent(location.hash.slice(1));
  const first = state.runs.find(r => r.id === wanted) ?? state.runs.find(r => r.reference) ?? state.runs[0];
  if (first) await selectRun(first.id); else render();
}

init().catch(error => { $('#scenario-head').innerHTML = `<div class="outcome bad">${esc(error.message)}</div>`; });
