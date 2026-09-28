// The advanced stage: a recorded run of the controller, inference by inference. The turns are the step band's
// progression and a timeline of cards: each turn's outcome, the model's response and every tool request with the
// guard's decision; selecting a turn shows its snapshot, trace, payload and recorded response in the shared columns.
// "Run live" records a new run against a real model; "Replay" feeds every recorded snapshot through all three
// assemblers.
import { initChrome, setInstrumentsSummary } from '../shared/chrome.js';
import { renderDelta } from '../shared/delta.js';
import { $, api, esc, postJson, reasonTextFor, stageNav, tag } from '../shared/format.js';
import { loadSnippets, renderAnswer, renderCandidates, renderColumnHeads, renderDecisions, renderRequest } from '../shared/panels.js';

const STAGE = 'advanced';

const page = {
  api,
  reasonText: () => '',
  noun: 'turn',
  /** The previous turn of the run, for the delta strip and the change chips; nothing on turn 1. */
  previous: () => {
    const turn = state.run?.turns.find(t => t.n === state.turn - 1);
    return turn ? { label: `turn ${turn.n}`, snapshot: turn.snapshot, trace: turn.trace } : null;
  },
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
  renderHead(); renderRoutes(); renderSteps(); renderTimeline(); renderBadges(); renderInstruments();
  const result = state.response?.results[0] ?? null;
  renderColumnHeads(page, result); renderDelta(page, result);
  renderCandidates(page, result); renderDecisions(page, result); renderRequest(page, result); renderAnswer(page, result); renderFoot();
}

/** The one line that stands for the instruments when talk mode folds them. */
function renderInstruments() {
  const run = state.run;
  setInstrumentsSummary(run ? `${run.id} · ${run.route?.id ?? 'incident-agent'} · ${run.model ?? '?'} via ${run.provider}` : 'no run loaded');
}

function renderHead() {
  const run = state.run;
  if (!run) { $('#scenario-head').innerHTML = state.error ? `<div class="outcome bad"><div class="ofoot">${esc(state.error)}</div></div>` : '<p class="hint">no recorded run yet: run one live</p>'; return; }
  const scenario = state.scenarios.find(s => s.id === run.scenario) ?? {};
  const faults = Object.keys(run.faults ?? {}).length ? `<strong>Injected faults</strong><span class="mono">${esc(JSON.stringify(run.faults))}</span>` : '';
  $('#scenario-head').innerHTML = `
    <div class="lead">
      <div class="eyebrow">${run.reference ? 'Reference run' : 'Live run'} · ${esc(run.route?.title ?? run.route?.id ?? 'incident-agent')} · ${STAGE} stage</div>
      <h1>${esc(run.title)}</h1>
      <p class="question">“${esc(run.question)}”</p>
      <p>${esc(scenario.description ?? '')}</p>
      <div class="proves"><strong>Proves</strong><span>${esc(scenario.proves ?? '')}</span>${(scenario.look_for ?? []).map(code => tag(code, 'bad code', page.reasonText(code))).join('')}</div>
      <div class="granted"><strong>Granted</strong>${run.capabilities.granted.map(id => tag(id, 'ok code xs')).join('')}
        <strong>Proposed, not granted</strong>${run.capabilities.not_granted.map(t => `${tag(t.tool, 'gray code xs')}<span class="meta">${esc(t.why)}</span>`).join('') || '<span class="meta">none</span>'}${faults}</div>
    </div>
    <aside class="factsheet">
      <div class="eyebrow">Run</div>
      <div class="kv">
        <span class="k">recorded</span><span class="v">${esc(run.started)}</span>
        <span class="k">route</span><span class="v">${esc(run.route?.id ?? 'incident-agent')} <span class="hint">· profile ${esc(run.route?.profile ?? '')}</span></span>
        <span class="k">model</span><span class="v">${esc(run.model ?? '?')} <span class="hint">via ${esc(run.provider)} · assembled by ${esc(run.assembler)}</span></span>
        <span class="k">stop</span><span class="v">${esc(run.stop.reason)} <span class="hint">at turn ${run.stop.turn} · ${esc(run.stop.detail)}</span></span>
        <span class="k">counts</span><span class="v">${run.observations.length} observations · ${run.denials.length} denied request${run.denials.length === 1 ? '' : 's'}${run.validation ? ` <span class="hint">· answer ${run.validation.ok ? 'follows' : 'misses part of'} the output contract</span>` : ''}</span>
        ${run.memory_proposal ? `<span class="k">memory proposed</span><span class="v prose" title="${esc(run.memory_proposal.note)}">${esc(run.memory_proposal.body)}</span>` : ''}
      </div>
    </aside>`;
}

function renderRoutes() {
  const routes = state.routes;
  if (!routes.length) { $('#routes').innerHTML = ''; return; }
  $('#routes').innerHTML = `<details ${state.run ? '' : 'open'}><summary><span class="eyebrow">Routes</span>two placement profiles for the same tools and guard, compared independently</summary>
    <div class="route-cards">${routes.map(route => {
      const runs = state.runs.filter(r => r.route === route.id);
      const active = state.run?.route?.id === route.id;
      return `<div class="route-card ${active ? 'active' : ''}">
        <div class="head"><strong>${esc(route.title)}</strong>${tag(route.policy_version, 'line')}${tag(`provider ${route.provider}`, 'line')}${route.budget ? tag(`budget.input ${route.budget.input}`, 'line') : ''}${active ? tag('shown', 'ok xs') : ''}</div>
        <p class="hint">${esc(route.summary)}</p>
        <div class="sec">placement, messages profile</div>
        <ol class="pipeline">${route.placement.map((p, i) => `<li><span class="num sm">${i + 1}</span><span>${esc(p.slot)} · ${esc(p.wrap)}</span></li>`).join('')}</ol>
        ${route.differences.length ? `<div class="sec">what differs</div><ul class="pipeline">${route.differences.map(d => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        <div class="sec">recorded runs</div>
        ${runs.length ? `<div class="hint">${runs.map(r => `<a href="#${esc(r.id)}" data-run="${esc(r.id)}" class="run-link">${esc(r.id)}</a> · ${r.turns} turns · ${esc(r.stop.reason)}`).join('<br>')}</div>` : '<p class="hint">none yet</p>'}
      </div>`;
    }).join('')}</div></details>`;
  $('#routes').querySelectorAll('a.run-link').forEach(a => a.addEventListener('click', event => { event.preventDefault(); selectRun(a.dataset.run); }));
}

/** What a turn's pill says: the tool the model asked for, or how the turn ended. */
function turnLabel(turn) {
  if (turn.outcome !== 'assembled') return turn.outcome;
  const request = turn.tool_requests[0];
  if (request) return `${request.call.name}${request.decision === 'denied' ? ' · denied' : ''}`;
  if (turn.response) return turn.response.tool_calls.length ? `${turn.response.tool_calls.length} requests` : 'answer';
  return turn.recovery ? 'recovery' : 'no call';
}

/** The step band: one pill per turn, the shown one in ink. */
function renderSteps() {
  const run = state.run;
  $('#steps').innerHTML = run ? run.turns.map(turn =>
    `<button type="button" data-n="${turn.n}" class="${turn.n === state.turn ? 'active' : ''}" title="turn ${turn.n} at ${esc(turn.at)}"><span class="num">${turn.n}</span>${esc(turnLabel(turn))}</button>`).join('') : '';
}

function renderTimeline() {
  const run = state.run;
  if (!run) { $('#timeline').innerHTML = ''; return; }
  const replay = state.replay;
  $('#timeline').innerHTML = `<div class="timeline-head"><span class="eyebrow">Turns</span><span class="meta">one inference each: its snapshot, its trace, the model's move, and what the guard decided</span></div>
    <div class="turns">${run.turns.map(turn => {
    const rp = replay?.turns.find(t => t.n === turn.n);
    const requests = turn.tool_requests.map(r => `<div class="tags">${tag(r.decision === 'approved' ? 'approved' : 'denied by the guard', r.decision === 'approved' ? 'ok xs' : 'bad xs', r.reason)}${r.executed ? tag(`observation ${r.observation} · ${r.ms} ms`, 'info xs') : ''}</div>
      <div class="call">${esc(r.call.name)}(${esc(JSON.stringify(r.call.arguments))})</div>${r.decision === 'denied' ? `<div class="hint">${esc(r.reason)}; never executed</div>` : ''}`).join('');
    const outcome = turn.outcome === 'assembled' ? tag(`assembled · ${turn.trace.result.input_tokens} tokens`, 'ok xs') : turn.outcome === 'refused' ? tag(`refused · ${turn.trace.refused.reason}`, 'bad xs') : tag(turn.outcome, 'bad xs');
    const response = turn.response ? (turn.response.tool_calls.length ? `<div class="hint">${turn.response.tool_calls.length} tool request${turn.response.tool_calls.length === 1 ? '' : 's'} · ${turn.response.durationMs} ms</div>` : `<div class="hint">answer · ${turn.response.durationMs} ms</div>`) : turn.recovery ? `<div class="hint">recovery: ${esc(turn.recovery.action ?? 'none')}</div>` : '<div class="hint">no model call</div>';
    const badge = rp ? (rp.agreement.agree && rp.results.every(r => r.outcome === 'passed') ? tag(`replay: ${rp.results.length} agree, match recorded`, 'ok xs') : tag('replay: DIFFERS', 'bad xs', rp.results.map(r => `${r.assembler}: ${r.outcome} ${r.detail ?? ''}`).join('\n'))) : '';
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
  if (state.busy === 'running') badges.push('<span class="chip">running the controller against the model…</span>');
  else if (state.busy === 'replaying') badges.push('<span class="chip">replaying every inference through all three…</span>');
  else if (state.busy) badges.push(`<span class="chip">${esc(state.busy)}…</span>`);
  else if (state.replay) {
    const ok = state.replay.turns.every(t => t.agreement.agree && t.results.every(r => r.outcome === 'passed'));
    badges.push(ok ? `<span class="chip ok dot">${state.replay.turns.length} inferences replayed · all three agree and match the recorded traces</span>` : '<span class="chip bad dot">replay differs from the record</span>');
  }
  if (state.error) badges.push(`<span class="chip bad dot">${esc(state.error)}</span>`);
  $('#agreement').outerHTML = `<span id="agreement" class="badges">${badges.join('')}</span>`;
}

function renderFoot() {
  const parts = state.assemblers.map(a => `${a.language}: ${a.available ? 'available' : 'not built'}`);
  $('#foot').textContent = `${parts.join(' · ')} · ${state.runs.length} recorded run${state.runs.length === 1 ? '' : 's'} · ← → switch turns`;
}

async function init() {
  initChrome();
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
  $('#steps').addEventListener('click', event => { const n = event.target.closest('button')?.dataset.n; if (n) selectTurn(Number(n)); });
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
  document.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName) || !state.run) return;
    if (event.key === 'ArrowRight' && state.turn < state.run.turns.length) selectTurn(state.turn + 1);
    if (event.key === 'ArrowLeft' && state.turn > 1) selectTurn(state.turn - 1);
  });
  const wanted = decodeURIComponent(location.hash.slice(1));
  const first = state.runs.find(r => r.id === wanted) ?? state.runs.find(r => r.reference) ?? state.runs[0];
  if (first) await selectRun(first.id); else render();
}

init().catch(error => { $('#scenario-head').innerHTML = `<div class="outcome bad"><div class="ofoot">${esc(error.message)}</div></div>`; });
