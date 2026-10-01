// The basic stage: five frozen steps, one assembler or all three, a budget override, and the four shared columns.
// Everything shown comes from /api/assemble: the frozen (or derived) snapshot and the assemblers' own traces and
// payloads. This page owns its state and controls; the columns and the chrome are shared with the other stages.
import { initChrome, setInstrumentsSummary } from '../shared/chrome.js';
import { renderDelta } from '../shared/delta.js';
import { $, api, esc, postJson, reasonChip, reasonTextFor, stageNav, tag, url, words } from '../shared/format.js';
import { loadSnippets, renderAnswer, renderCandidates, renderColumnHeads, renderDecisions, renderRequest, shownResult } from '../shared/panels.js';

const STAGE = 'basic';
const RENDERERS = { fixture: 'fixture-xml/v1', messages: 'cwa-messages/v1' };

const page = {
  api,
  reasonText: () => '',
  /** The step the page showed before this one, for the delta strip and the change chips; nothing on the first step shown. */
  previous: () => state.previous,
  state: {
    previous: null,
    scenarios: [], assemblers: [], providers: [], contract: null,
    scenario: null, variant: 'fixture', assembler: 'all', budget: null, provider: null,
    response: null, answers: {}, sending: null, busy: false, error: null,
    snippets: null, snippetLang: 'typescript', snippetTab: 'anthropic',
  },
};
const { state } = page;

const current = () => state.scenarios.find(s => s.id === state.scenario);
const frozenBudget = () => current()?.meta.budget.input;

async function assemble() {
  state.busy = true; state.error = null; state.answers = {}; state.snippets = null;
  render();
  try {
    state.response = await postJson('/api/assemble', {
      scenario: state.scenario, variant: state.variant,
      assemblers: state.assembler === 'all' ? undefined : [state.assembler],
      budget: state.budget === null ? undefined : { input: state.budget },
    });
  } catch (error) {
    state.response = null; state.error = error.message;
  }
  state.busy = false;
  render();
  await loadSnippets(page, shownResult(state.response));
}

function selectScenario(id) {
  if (state.response && state.scenario && state.scenario !== id) {
    state.previous = { label: `step ${current().meta.step}`, snapshot: state.response.snapshot, trace: shownResult(state.response)?.trace ?? null };
  }
  state.scenario = id; state.budget = null;
  $('#budget').value = frozenBudget();
  location.hash = id;
  assemble();
}

function render() {
  for (const button of $('#steps').querySelectorAll('button')) button.classList.toggle('active', button.dataset.id === state.scenario);
  renderScenario(); renderBadges(); renderInstruments();
  const result = shownResult(state.response);
  renderColumnHeads(page, result); renderDelta(page, result);
  renderCandidates(page, result); renderDecisions(page, result); renderRequest(page, result); renderAnswer(page, result); renderFoot();
}

/** The one line that stands for the instruments when talk mode folds them. */
function renderInstruments() {
  const assembler = state.assembler === 'all' ? 'all three' : state.assemblers.find(a => a.id === state.assembler)?.language ?? state.assembler;
  setInstrumentsSummary(`${assembler} · ${RENDERERS[state.variant]} · budget.input ${state.budget ?? frozenBudget() ?? '?'}${state.budget === null ? '' : ' (derived)'}`);
}

function renderScenario() {
  const scenario = current();
  if (!scenario) return;
  const { meta } = scenario;
  const derived = state.response?.derived;
  const snapshot = state.response?.snapshot;
  const trace = shownResult(state.response)?.trace;
  const digest = trace?.context?.snapshot_digest;
  $('#scenario').innerHTML = `
    <div class="lead">
      <div class="kicker">Step ${meta.step} of ${state.scenarios.length} · ${STAGE} stage</div>
      <h1>${esc(meta.title)}</h1>
      <p class="question">“${esc(meta.question)}”</p>
      <p>${esc(meta.description)}</p>
      <div class="proves"><strong>Proves</strong><span>${esc(meta.proves)}</span>${meta.look_for.map(code => reasonChip(code, 'bad code', page.reasonText(code))).join('')}</div>
    </div>
    <aside class="factsheet">
      <div class="label">Snapshot</div>
      <div class="kv">
        <span class="k">state</span><span class="v${derived ? ' derived' : ''}">${derived ? `derived · budget.input ${state.budget} (frozen ${meta.budget.input})` : 'frozen'}</span>
        <span class="k">budget.input</span><span class="v">${snapshot?.budget.input ?? meta.budget.input} <span class="hint">· reserved_output ${snapshot?.budget.reserved_output ?? meta.budget.reserved_output}</span></span>
        <span class="k">tokenizer</span><span class="v">${esc(snapshot?.tokenizer ?? '')}</span>
        <span class="k">renderer</span><span class="v">${esc(snapshot?.renderer ?? RENDERERS[state.variant])}</span>
        ${trace ? `<span class="k">profile</span><span class="v">${esc(trace.profile.id)} v${trace.profile.version}</span>
        <span class="k">route policy</span><span class="v">${esc(trace.context.route_policy_version)}</span>` : ''}
        <span class="k">digest</span><span class="v">${esc(digest ? digest.slice(0, 16) + '…' : '—')}</span>
      </div>
      <a href="${url(`/api/scenarios/${encodeURIComponent(scenario.id)}/${state.variant}/snapshot.json`)}" target="_blank">frozen snapshot.json</a>
    </aside>`;
}

function renderBadges() {
  const badges = [];
  if (state.busy) badges.push('<span class="chip">assembling…</span>');
  else if (state.error) badges.push(`<span class="chip bad dot">${esc(state.error)}</span>`);
  else if (state.response) {
    const { agreement, results, expectation } = state.response;
    const judged = results.filter(r => ['assembled', 'refused', 'rejected'].includes(r.outcome)).length;
    if (results.length > 1) {
      badges.push(agreement.agree
        ? `<span class="chip ok dot" title="payload bytes and traces (without trace_id, timings and recovery.detail) are identical">${judged} assemblers agree</span>`
        : `<span class="chip fill dot" title="${esc(agreement.differences.map(d => `${d.assembler} vs ${d.against}: ${d.detail}`).join('\n'))}">assemblers DISAGREE</span>`);
    }
    if (expectation) {
      const failed = expectation.results.filter(r => r.outcome === 'failed');
      badges.push(failed.length === 0
        ? `<span class="chip ${expectation.reviewed ? 'ok' : 'warn'} dot" title="generated by ${esc(expectation.generated_by)}${expectation.reviewed ? ', reviewed' : ', not yet reviewed by a person'}">matches expectation${expectation.reviewed ? '' : ' · unreviewed'}</span>`
        : `<span class="chip fill dot" title="${esc(failed.map(f => `${f.assembler}: ${f.detail}`).join('\n'))}">expectation NOT met</span>`);
    } else if (state.response.derived) {
      badges.push('<span class="chip warn dot" title="a derived snapshot has no committed expectation">no expectation · derived</span>');
    }
  }
  $('#agreement').outerHTML = `<span id="agreement" class="badges" data-tour="agreement">${badges.join('')}</span>`;
}

function renderFoot() {
  const parts = state.assemblers.map(a => `${a.language}: ${a.available ? 'available' : `not built (${a.missing.join(', ')})`}`);
  const results = state.response?.results ?? [];
  const timing = results.length ? ' · ' + results.map(r => `${r.assembler} ${r.outcome} ${r.durationMs} ms`).join(', ') : '';
  $('#foot').textContent = `${parts.join(' · ')}${timing} · ← → switch steps`;
}

async function init() {
  initChrome();
  $('#stages').innerHTML = stageNav(STAGE);
  const [st, contract] = await Promise.all([api('/api/state'), api('/api/contract')]);
  Object.assign(state, { scenarios: st.scenarios.filter(s => s.id.startsWith(`${STAGE}/`)), assemblers: st.assemblers, providers: st.providers, contract });
  page.reasonText = reasonTextFor(contract);
  $('#assembler').innerHTML = '<option value="all">all three</option>' + st.assemblers.map(a =>
    `<option value="${esc(a.id)}"${a.available ? '' : ' disabled'}>${esc(a.language)}${a.available ? '' : ' (not built)'}</option>`).join('');
  $('#steps').innerHTML = state.scenarios.map(s => `<button type="button" data-id="${esc(s.id)}" title="${esc(s.meta.title)}"><span class="num">${s.meta.step}</span>${esc(words(s.meta.id))}</button>`).join('');
  $('#steps').addEventListener('click', event => { const id = event.target.closest('button')?.dataset.id; if (id) selectScenario(id); });
  $('#assembler').addEventListener('change', event => { state.assembler = event.target.value; assemble(); });
  $('#variant').addEventListener('change', event => { state.variant = event.target.value; assemble(); });
  $('#budget').addEventListener('change', event => {
    const value = Number(event.target.value);
    state.budget = Number.isInteger(value) && value !== frozenBudget() ? value : null;
    assemble();
  });
  $('#reset').addEventListener('click', () => { state.budget = null; $('#budget').value = frozenBudget(); assemble(); });
  document.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    const index = state.scenarios.findIndex(s => s.id === state.scenario);
    if (event.key === 'ArrowRight' && index < state.scenarios.length - 1) selectScenario(state.scenarios[index + 1].id);
    if (event.key === 'ArrowLeft' && index > 0) selectScenario(state.scenarios[index - 1].id);
  });
  const wanted = decodeURIComponent(location.hash.slice(1));
  selectScenario(state.scenarios.find(s => s.id === wanted)?.id ?? state.scenarios[0].id);
}

init().catch(error => { $('#scenario').innerHTML = `<div class="outcome bad"><div class="ofoot">${esc(error.message)}</div></div>`; });
