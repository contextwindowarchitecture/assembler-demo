// The four-column screen. Everything shown comes from the server's /api/assemble response: the frozen (or derived)
// snapshot and the assemblers' own traces and payloads. This script formats; it never decides.
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const tag = (text, cls = '', title = '') => `<span class="tag ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
const short = value => String(value).replace(/^\d+-/, '');
const when = iso => iso ? iso.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1Z') : '';

const state = {
  scenarios: [], assemblers: [], providers: [], contract: null,
  scenario: null, variant: 'fixture', assembler: 'all', budget: null, provider: null,
  response: null, answers: {}, sending: null, busy: false, error: null,
};

async function api(path, options) {
  const res = await fetch(path, options);
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

const current = () => state.scenarios.find(s => s.id === state.scenario);
const frozenBudget = () => current()?.meta.budget.input;

/** The result the columns show: the chosen assembler's, or the first judged one when all three ran. */
function shown() {
  const results = state.response?.results ?? [];
  return results.find(r => r.outcome === 'assembled' || r.outcome === 'refused') ?? results.find(r => r.outcome === 'rejected') ?? results[0] ?? null;
}

async function assemble() {
  state.busy = true; state.error = null; state.answers = {};
  render();
  try {
    state.response = await api('/api/assemble', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        scenario: state.scenario, variant: state.variant,
        assemblers: state.assembler === 'all' ? undefined : [state.assembler],
        budget: state.budget === null ? undefined : { input: state.budget },
      }),
    });
  } catch (error) {
    state.response = null; state.error = error.message;
  }
  state.busy = false;
  render();
}

function selectScenario(id) {
  state.scenario = id; state.budget = null;
  $('#budget').value = frozenBudget();
  location.hash = id;
  assemble();
}

function render() {
  renderSteps(); renderScenario(); renderBadges();
  const result = shown();
  renderCandidates(result); renderDecisions(result); renderRequest(result); renderAnswer(result); renderFoot(result);
}

function renderSteps() {
  for (const button of $('#steps').querySelectorAll('button')) button.classList.toggle('active', button.dataset.id === state.scenario);
}

function renderScenario() {
  const scenario = current();
  if (!scenario) return;
  const { meta } = scenario;
  const derived = state.response?.derived;
  const digest = shown()?.trace?.context?.snapshot_digest;
  $('#scenario').innerHTML = `
    <div>
      <h1>Step ${meta.step}: ${esc(meta.title)}</h1>
      <p class="question">“${esc(meta.question)}”</p>
      <p>${esc(meta.description)}</p>
      <p class="proves"><strong>Proves:</strong> ${esc(meta.proves)} ${meta.look_for.map(code => tag(code, 'reason', reasonText(code))).join(' ')}</p>
    </div>
    <div class="meta">
      <span>${derived ? `<span class="derived">derived snapshot: budget.input ${state.budget} (frozen: ${meta.budget.input})</span>` : `frozen snapshot · budget.input ${meta.budget.input}, reserved_output ${meta.budget.reserved_output}`}</span>
      <span>${esc(state.response?.snapshot?.tokenizer ?? '')} · ${esc(state.response?.snapshot?.renderer ?? '')}</span>
      <span>digest <span class="mono">${esc(digest ? digest.slice(0, 16) + '…' : '—')}</span></span>
      <span><a href="/api/scenarios/${encodeURIComponent(scenario.id)}/${state.variant}/snapshot.json" target="_blank">frozen snapshot.json</a></span>
    </div>`;
}

function reasonText(code) {
  const base = code.startsWith('missing_field:') ? 'missing_field:<name>' : code;
  const reason = state.contract?.reasons?.[base];
  return reason ? `${reason.rule}: ${reason.text}` : '';
}

function renderBadges() {
  const badges = [];
  if (state.busy) badges.push('<span class="badge">assembling…</span>');
  else if (state.error) badges.push(`<span class="badge bad">${esc(state.error)}</span>`);
  else if (state.response) {
    const { agreement, results, expectation } = state.response;
    const judged = results.filter(r => ['assembled', 'refused', 'rejected'].includes(r.outcome)).length;
    if (results.length > 1) {
      badges.push(agreement.agree
        ? `<span class="badge ok" title="payload bytes and traces (without trace_id and timings) are identical">${judged} assemblers agree</span>`
        : `<span class="badge bad" title="${esc(agreement.differences.map(d => `${d.assembler} vs ${d.against}: ${d.detail}`).join('\n'))}">assemblers DISAGREE</span>`);
    }
    if (expectation) {
      const failed = expectation.results.filter(r => r.outcome === 'failed');
      badges.push(failed.length === 0
        ? `<span class="badge ${expectation.reviewed ? 'ok' : 'warn'}" title="generated by ${esc(expectation.generated_by)}${expectation.reviewed ? ', reviewed' : ', not yet reviewed by a person'}">matches expectation${expectation.reviewed ? '' : ' (unreviewed)'}</span>`
        : `<span class="badge bad" title="${esc(failed.map(f => `${f.assembler}: ${f.detail}`).join('\n'))}">expectation NOT met</span>`);
    } else if (state.response.derived) {
      badges.push('<span class="badge warn" title="a derived snapshot has no committed expectation">no expectation (derived)</span>');
    }
  }
  $('#agreement').outerHTML = `<span id="agreement">${badges.join(' ')}</span>`;
}

function itemStatus(item, trace) {
  if (!trace) return { cls: '', label: '' };
  const excluded = trace.excluded.find(row => row.item_id === item.id && row.stage === 'assembler');
  if (excluded) return { cls: 'excluded', label: tag(excluded.reason, 'reason', reasonText(excluded.reason)) };
  const compressed = trace.compressed.find(row => row.item_id === item.id);
  if (compressed) return { cls: 'compressed', label: tag(`compressed ${compressed.from} → ${compressed.to}`, 'status-compressed', `variant ${compressed.variant_id} (${compressed.method})`) };
  const included = trace.included.find(row => row.item_id === item.id);
  if (included) return { cls: 'included', label: tag(`included · ${included.tokens} tokens`, 'status-included') };
  if (trace.refused.bool) return { cls: '', label: tag('admitted; assembly refused', '') };
  return { cls: '', label: tag('not placed', '') };
}

function renderCandidates(result) {
  const snapshot = state.response?.snapshot;
  const body = $('#candidates .body');
  if (!snapshot) { body.innerHTML = state.busy ? '<p class="spinner">loading…</p>' : ''; return; }
  const trace = result?.trace ?? null;
  body.innerHTML = snapshot.batches.map(batch => `
    <div class="producer">
      <div class="producer-head"><span class="mono">${esc(batch.producer.id)}</span><span class="kind">${esc(batch.producer.kind)}</span>
        <span class="kind">${batch.items.length} item${batch.items.length === 1 ? '' : 's'}${batch.excluded.length ? `, ${batch.excluded.length} reported excluded` : ''}</span></div>
      ${batch.items.map(item => {
        const status = itemStatus(item, trace);
        const scope = item.scope ? Object.entries(item.scope).map(([k, v]) => `${k}=${v}`).join(' ') : '';
        return `<div class="item ${status.cls}">
          <div class="id mono">${esc(item.id)}</div>
          <div class="tags">${status.label}${tag(item.slot, 'slot')}${tag(item.authority, '', 'authority')}${tag(item.trust, '', 'trust')}${item.tier ? tag(`tier ${item.tier}`, '', 'the item claims this tier') : ''}${item.relevance !== undefined ? tag(`rerank ${item.relevance}`) : ''}${item.injection_risk ? tag(item.injection_risk) : ''}</div>
          <div class="tags">${tag(`fresh ${when(item.freshness)}`)}${item.expires ? tag(`expires ${when(item.expires)}`) : ''}${scope ? tag(scope, '', 'scope') : ''}${item.variants?.length ? tag(`${item.variants.length} variant${item.variants.length === 1 ? '' : 's'}`) : ''}</div>
          <details><summary>${esc(item.body.length > 90 ? item.body.slice(0, 90) + '…' : item.body)}</summary><div class="snippet">${esc(item.body)}</div>
            ${(item.variants ?? []).map(v => `<div class="snippet"><strong>${esc(v.id)}</strong> (${esc(v.method)}): ${esc(v.body)}</div>`).join('')}</details>
        </div>`;
      }).join('')}
      ${batch.excluded.map(row => `<div class="item producer-excluded"><div class="id mono">${esc(row.item_id)}</div>
        <div class="tags">${tag(row.reason, 'reason', reasonText(row.reason))}${tag('reported by the producer; body never sent')}</div></div>`).join('')}
    </div>`).join('');
}

function renderDecisions(result) {
  const body = $('#decisions .body');
  if (!result) { body.innerHTML = state.busy ? '<p class="spinner">assembling…</p>' : ''; return; }
  if (!result.trace) {
    body.innerHTML = `<div class="outcome bad">${esc(result.outcome)} (${esc(result.assembler)})<small>${esc(result.detail)}</small></div>
      <p class="hint">${result.outcome === 'rejected' ? 'The snapshot failed its schemas or a snapshot check, so there is no assembly and no trace (R-17). This is the application\'s error in building the snapshot.' : ''}</p>`;
    return;
  }
  const { trace } = result;
  const snapshot = state.response.snapshot;
  const outcome = trace.refused.bool
    ? `<div class="outcome bad">Refused: <span class="mono">${esc(trace.refused.reason)}</span><small>${esc(reasonText(trace.refused.reason))}</small>${trace.recovery ? `<small>recovery: <span class="mono">${esc(trace.recovery.action)}</span>${trace.recovery.detail ? ` · ${esc(trace.recovery.detail)}` : ''}</small>` : ''}</div>`
    : `<div class="outcome ok">Assembled · ${trace.result.input_tokens} of ${snapshot.budget.input} input tokens<small>${trace.included.length} included, ${trace.compressed.length} compressed, ${trace.excluded.length} excluded · hash <span class="mono">${esc(trace.result.hash.slice(0, 16))}…</span></small></div>`;
  const included = trace.included.length ? `<h3>Included (placement order)</h3><table><tr><th>slot</th><th>item</th><th class="num">tokens</th></tr>
    ${trace.included.map(row => `<tr><td>${esc(row.slot)}</td><td class="mono">${esc(row.item_id)}</td><td class="num">${row.tokens}</td></tr>`).join('')}</table>` : '';
  const compressed = trace.compressed.length ? `<h3>Compressed</h3><table><tr><th>item</th><th class="num">from → to</th><th>variant</th></tr>
    ${trace.compressed.map(row => `<tr><td class="mono">${esc(row.item_id)}</td><td class="num">${row.from} → ${row.to}</td><td class="mono">${esc(row.variant_id)} <span class="hint">(${esc(row.method)})</span></td></tr>`).join('')}</table>` : '';
  const excluded = trace.excluded.length ? `<h3>Excluded</h3><table><tr><th>item</th><th>reason</th><th>stage</th></tr>
    ${trace.excluded.map(row => `<tr><td class="mono">${esc(row.item_id)}</td><td>${tag(row.reason, 'reason', reasonText(row.reason))}${row.duplicate_of ? ` <span class="hint">of ${esc(row.duplicate_of)}</span>` : ''}${row.superseded_by ? ` <span class="hint">by ${esc(row.superseded_by)}</span>` : ''}</td><td>${esc(row.stage)}</td></tr>`).join('')}</table>` : '<h3>Excluded</h3><p class="hint">nothing</p>';
  const codes = [...new Set([...trace.excluded.map(r => r.reason), ...(trace.refused.reason ? [trace.refused.reason] : [])])];
  const reasons = codes.length ? `<h3>Reason codes in this assembly</h3><dl class="reason-list">${codes.map(code => `<dt>${esc(code)}</dt><dd>${esc(reasonText(code) || 'not in the registry')}</dd>`).join('')}</dl>` : '';
  const conflicts = trace.conflicts.length ? `<h3>Conflicts</h3><table><tr><th>group</th><th>kind</th><th>resolution</th><th>winner</th></tr>
    ${trace.conflicts.map(c => `<tr><td class="mono">${esc(c.group_id)}</td><td>${esc(c.kind)}</td><td>${esc(c.resolution)} (${esc(c.decided_by)})</td><td class="mono">${esc(c.winner ?? '—')}</td></tr>`).join('')}</table>` : '';
  const defaults = trace.defaults_filled.length ? `<p class="hint">${trace.defaults_filled.length} default${trace.defaults_filled.length === 1 ? '' : 's'} filled (R-3)</p>` : '<p class="hint">no defaults filled: every producer declared its policy fields</p>';
  body.innerHTML = `${outcome}${included}${compressed}${excluded}${reasons}${conflicts}${defaults}
    <h3>Context</h3><div class="kv">
      <span>assembler</span><span class="mono">${esc(result.assembler)} · ${result.durationMs} ms</span>
      <span>profile</span><span class="mono">${esc(trace.profile.id)} v${trace.profile.version}</span>
      <span>route policy</span><span class="mono">${esc(trace.context.route_policy_version)}</span>
      <span>tokenizer</span><span class="mono">${esc(trace.context.tokenizer)}</span>
      <span>renderer</span><span class="mono">${esc(trace.context.renderer)}</span>
      <span>assembly time</span><span class="mono">${esc(trace.context.assembly_time)}</span>
      <span>snapshot digest</span><span class="mono">${esc(trace.context.snapshot_digest)}</span>
      ${trace.result ? `<span>payload hash</span><span class="mono">${esc(trace.result.hash)}</span>` : ''}
    </div>`;
}

function renderRequest(result) {
  const body = $('#request .body');
  if (!result) { body.innerHTML = ''; return; }
  if (result.outcome === 'refused') {
    body.innerHTML = `<div class="norequest"><div class="big">No model request</div><p>The assembly was refused with <span class="mono">${esc(result.trace.refused.reason)}</span>, so there is no payload to send (R-17). Nothing reaches the model.</p></div>`;
    return;
  }
  if (result.outcome !== 'assembled') { body.innerHTML = `<p class="hint">${esc(result.outcome)}: ${esc(result.detail)}</p>`; return; }
  if (state.variant === 'messages') {
    let ir;
    try { ir = JSON.parse(result.payload); } catch { body.innerHTML = `<pre>${esc(result.payload)}</pre>`; return; }
    body.innerHTML = `
      <div class="section-label">system (${ir.system.length})</div>
      ${ir.system.map(e => `<div class="entry"><div class="id">${esc(e.id)}${e.conflict ? ` · conflict ${esc(e.conflict)}` : ''}</div>${esc(e.text)}</div>`).join('') || '<p class="hint">none</p>'}
      <div class="section-label">tools (${ir.tools.length})</div>
      ${ir.tools.map(e => `<div class="entry"><div class="id">${esc(e.id)}</div><pre>${esc(e.text)}</pre></div>`).join('') || '<p class="hint">none: the basic stage grants no capabilities</p>'}
      <div class="section-label">messages (${ir.messages.length})</div>
      ${ir.messages.map(m => `<div class="entry"><div class="id">role: ${esc(m.role)}</div><pre>${esc(m.content)}</pre></div>`).join('')}
      <p class="hint">Prior turns stay inside the one user message as a transcript; only the query is the live turn (R-7). The bytes above are the RFC 8785 form the hash covers.</p>`;
  } else {
    body.innerHTML = `<pre>${esc(result.payload)}</pre><p class="hint">The exact bytes the hash covers. Switch the rendering to cwa-messages/v1 to see the same items as a message request.</p>`;
  }
}

function renderAnswer(result) {
  const body = $('#answer .body');
  if (!result || result.outcome !== 'assembled') {
    body.innerHTML = result?.outcome === 'refused' ? '<p class="hint">Nothing to send: the assembly was refused.</p>' : '';
    return;
  }
  if (state.variant !== 'messages') {
    body.innerHTML = '<p class="hint">Switch the rendering to cwa-messages/v1 to send this assembly to a model. The fixture rendering exists for the byte-exact comparison.</p>';
    return;
  }
  const providers = state.providers;
  const configured = providers.filter(p => p.configured);
  if (!configured.some(p => p.id === state.provider)) state.provider = configured[0]?.id ?? null;
  const options = providers.map(p => `<option value="${esc(p.id)}"${p.configured ? '' : ' disabled'}${p.id === state.provider ? ' selected' : ''}>${esc(p.label)} · ${esc(p.model ?? 'not configured')}</option>`).join('');
  const legend = providers.map(p => `<li><strong>${esc(p.label)}</strong>: ${p.configured ? `${esc(p.model)}${p.base_url ? ` at ${esc(p.base_url)}` : ''}${p.fallbacks ? ', refusal fallbacks on' : ''}` : `<span class="hint">${esc(p.reason)}</span>`}</li>`).join('');
  const cards = providers.filter(p => state.answers[p.id]).map(p => {
    const a = state.answers[p.id];
    return `<div class="entry">
      <div class="id">${esc(p.label)} · ${esc(a.model ?? p.model)}${a.usage ? ` · ${a.usage.input_tokens} in / ${a.usage.output_tokens} out` : ''}${a.durationMs ? ` · ${a.durationMs} ms` : ''}${a.stop_reason ? ` · stop: ${esc(a.stop_reason)}` : ''}</div>
      ${a.error ? `<div class="outcome bad">${esc(a.error)}</div>` : ''}
      ${a.stop_details ? `<div class="outcome bad">refusal: ${esc(a.stop_details.category ?? '')} ${esc(a.stop_details.explanation ?? '')}</div>` : ''}
      ${a.fallbacks?.length ? `<p class="hint">${esc(a.fallbacks.join('; '))}</p>` : ''}
      ${a.tool_calls?.length ? `<h3>Tool calls requested</h3><pre>${esc(JSON.stringify(a.tool_calls, null, 2))}</pre><p class="hint">Not executed: the basic stage has no tool loop.</p>` : ''}
      ${a.text !== undefined ? `<div class="answer-text">${esc(a.text)}</div>` : ''}
      ${a.request ? `<details><summary>outbound request (exact)</summary><pre>${esc(JSON.stringify(a.request, null, 2))}</pre></details>` : ''}
    </div>`;
  }).join('');
  body.innerHTML = `
    <div class="sendrow">
      <select id="provider" ${configured.length ? '' : 'disabled'}>${options}</select>
      <button class="primary" id="send" ${!configured.length || state.sending ? 'disabled' : ''}>Send</button>
      <button id="send-all" ${configured.length < 2 || state.sending ? 'disabled' : ''} title="the same request to every configured provider">Send to all</button>
      <button id="recheck" title="ask again which providers are configured, for example after starting a local model server">re-check</button>
    </div>
    ${state.sending ? `<p class="spinner">asking ${esc(state.sending)}…</p>` : ''}
    <p class="hint">max_tokens is the route's reserved_output; the request is captured before it is sent.</p>
    ${cards}
    <details><summary>providers</summary><ul class="hint">${legend}</ul></details>`;
  $('#provider')?.addEventListener('change', event => { state.provider = event.target.value; });
  const send = async ids => {
    for (const id of ids) {
      state.sending = state.providers.find(p => p.id === id)?.label ?? id; renderAnswer(result);
      try {
        state.answers[id] = await api('/api/answer', { method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ provider: id, payload: result.payload, reserved_output: state.response.snapshot.budget.reserved_output }) });
      } catch (error) { state.answers[id] = { error: error.message }; }
    }
    state.sending = null; renderAnswer(result);
  };
  $('#send')?.addEventListener('click', () => send([state.provider]));
  $('#send-all')?.addEventListener('click', () => send(configured.map(p => p.id)));
  $('#recheck')?.addEventListener('click', async () => { state.providers = await api('/api/providers'); renderAnswer(result); });
}

function renderFoot(result) {
  const parts = state.assemblers.map(a => `${a.language}: ${a.available ? 'available' : `not built (${a.missing.join(', ')})`}`);
  const results = state.response?.results ?? [];
  const timing = results.length ? ' · ' + results.map(r => `${r.assembler} ${r.outcome} ${r.durationMs} ms`).join(', ') : '';
  $('#foot').textContent = `${parts.join(' · ')}${timing}${result ? '' : ''} · ← → switch steps`;
}

async function init() {
  const [st, contract] = await Promise.all([api('/api/state'), api('/api/contract')]);
  Object.assign(state, { scenarios: st.scenarios, assemblers: st.assemblers, providers: st.providers, contract });
  $('#assembler').innerHTML = '<option value="all">all three</option>' + st.assemblers.map(a =>
    `<option value="${esc(a.id)}"${a.available ? '' : ' disabled'}>${esc(a.language)}${a.available ? '' : ' (not built)'}</option>`).join('');
  $('#steps').innerHTML = st.scenarios.map(s => `<button type="button" data-id="${esc(s.id)}" title="${esc(s.meta.title)}">${s.meta.step} · ${esc(short(s.meta.id))}</button>`).join('');
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
    const index = st.scenarios.findIndex(s => s.id === state.scenario);
    if (event.key === 'ArrowRight' && index < st.scenarios.length - 1) selectScenario(st.scenarios[index + 1].id);
    if (event.key === 'ArrowLeft' && index > 0) selectScenario(st.scenarios[index - 1].id);
  });
  const wanted = decodeURIComponent(location.hash.slice(1));
  selectScenario(st.scenarios.find(s => s.id === wanted)?.id ?? st.scenarios[0].id);
}

init().catch(error => { $('#scenario').innerHTML = `<div class="outcome bad">${esc(error.message)}</div>`; });
