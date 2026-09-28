// The four columns every stage shows, as functions of a page: candidate context, CWA decisions, the outbound
// request (with the SDK snippets), and the model answer. A page passes itself in; the panels read its state and
// call back into it. They format; they never decide.
import { $, esc, postJson, tag, when } from './format.js';

/** The result a page's columns show: the chosen assembler's, or the first judged one when all ran. */
export function shownResult(response) {
  const results = response?.results ?? [];
  return results.find(r => r.outcome === 'assembled' || r.outcome === 'refused') ?? results.find(r => r.outcome === 'rejected') ?? results[0] ?? null;
}

function itemStatus(item, trace, reasonText) {
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

export function renderCandidates(page, result) {
  const { state, reasonText } = page;
  const snapshot = state.response?.snapshot;
  const body = $('#candidates .body');
  if (!snapshot) { body.innerHTML = state.busy ? '<p class="spinner">loading…</p>' : ''; return; }
  const trace = result?.trace ?? null;
  const conflicts = new Map(snapshot.conflicts.flatMap(group => group.items.map(id => [id, group])));
  body.innerHTML = snapshot.batches.map(batch => `
    <div class="producer">
      <div class="producer-head"><span class="mono">${esc(batch.producer.id)}</span><span class="kind">${esc(batch.producer.kind)}</span>
        <span class="kind">${batch.items.length} item${batch.items.length === 1 ? '' : 's'}${batch.excluded.length ? `, ${batch.excluded.length} reported excluded` : ''}</span></div>
      ${batch.items.map(item => {
        const status = itemStatus(item, trace, reasonText);
        const scope = item.scope ? Object.entries(item.scope).map(([k, v]) => `${k}=${v}`).join(' ') : '';
        const group = conflicts.get(item.id);
        return `<div class="item ${status.cls}">
          <div class="id mono">${esc(item.id)}</div>
          <div class="tags">${status.label}${tag(item.slot, 'slot')}${tag(item.authority, '', 'authority')}${tag(item.trust, '', 'trust')}${item.tier ? tag(`tier ${item.tier}`, '', 'the item claims this tier') : ''}${item.relevance !== undefined ? tag(`rerank ${item.relevance}`) : ''}${item.injection_risk ? tag(item.injection_risk) : ''}${group ? tag(`conflict ${group.id}`, 'conflict', `${group.kind} group${group.fact ? ` on fact ${group.fact}` : ''}`) : ''}</div>
          <div class="tags">${tag(`fresh ${when(item.freshness)}`)}${item.expires ? tag(`expires ${when(item.expires)}`) : ''}${scope ? tag(scope, '', 'scope') : ''}${item.variants?.length ? tag(`${item.variants.length} variant${item.variants.length === 1 ? '' : 's'}`) : ''}${item.source ? tag(`source ${item.source}`, '', 'source, as the producer names it') : ''}</div>
          <details><summary>${esc(item.body.length > 90 ? item.body.slice(0, 90) + '…' : item.body)}</summary><div class="snippet">${esc(item.body)}</div>
            ${(item.variants ?? []).map(v => `<div class="snippet"><strong>${esc(v.id)}</strong> (${esc(v.method)}): ${esc(v.body)}</div>`).join('')}</details>
        </div>`;
      }).join('')}
      ${batch.excluded.map(row => `<div class="item producer-excluded"><div class="id mono">${esc(row.item_id)}</div>
        <div class="tags">${tag(row.reason, 'reason', reasonText(row.reason))}${row.duplicate_of ? tag(`duplicate of ${row.duplicate_of}`) : ''}${row.superseded_by ? tag(`superseded by ${row.superseded_by}`) : ''}${tag('reported by the producer; body never sent')}</div></div>`).join('')}
    </div>`).join('');
}

export function renderDecisions(page, result) {
  const { state, reasonText } = page;
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

const SNIPPET_TABS = [['assemble', 'Assemble (CWA)'], ['local', 'OpenAI SDK · local server'], ['openai', 'OpenAI SDK'], ['anthropic', 'Anthropic SDK']];

function renderSnippets(state) {
  const snippets = state.snippets;
  if (!snippets) return '<div class="section-label">Use it in your code</div><p class="spinner">building snippets…</p>';
  if (snippets.error) return `<div class="section-label">Use it in your code</div><p class="hint">${esc(snippets.error)}</p>`;
  const tabs = SNIPPET_TABS.filter(([id]) => snippets[id]);
  if (!tabs.some(([id]) => id === state.snippetTab)) state.snippetTab = tabs[0][0];
  const code = snippets[state.snippetTab]?.[state.snippetLang] ?? '';
  return `<div class="section-label">Use it in your code</div>
    <div class="sendrow">
      <select id="snippet-tab">${tabs.map(([id, label]) => `<option value="${id}"${id === state.snippetTab ? ' selected' : ''}>${esc(label)}</option>`).join('')}</select>
      <select id="snippet-lang"><option value="typescript"${state.snippetLang === 'typescript' ? ' selected' : ''}>TypeScript</option><option value="python"${state.snippetLang === 'python' ? ' selected' : ''}>Python</option></select>
      <button id="snippet-copy" type="button">copy</button>
    </div>
    <pre class="snippet-code" id="snippet-code">${esc(code)}</pre>
    <p class="hint">The object in the call is the request the provider sends, built by the same code. Copy it into your application: the assembler's payload is all it takes.</p>`;
}

/** Fetch the SDK snippets for a successful messages assembly into page.state.snippets, then redraw the request. */
export async function loadSnippets(page, result) {
  const { state } = page;
  state.snippets = null;
  if (state.variant !== 'messages' || result?.outcome !== 'assembled') return;
  try {
    state.snippets = await postJson('/api/snippets', { payload: result.payload, reserved_output: state.response.snapshot.budget.reserved_output });
  } catch (error) { state.snippets = { error: error.message }; }
  renderRequest(page, result);
}

export function renderRequest(page, result) {
  const { state } = page;
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
      ${ir.tools.map(e => `<div class="entry"><div class="id">${esc(e.id)}</div><pre>${esc(e.text)}</pre></div>`).join('') || '<p class="hint">none: no capabilities are granted on this route</p>'}
      <div class="section-label">messages (${ir.messages.length})</div>
      ${ir.messages.map(m => `<div class="entry"><div class="id">role: ${esc(m.role)}</div><pre>${esc(m.content)}</pre></div>`).join('')}
      <p class="hint">Prior turns stay inside the one user message as a transcript; only the query is the live turn (R-7). The bytes above are the RFC 8785 form the hash covers.</p>
      ${renderSnippets(state)}`;
    $('#snippet-tab')?.addEventListener('change', event => { state.snippetTab = event.target.value; renderRequest(page, result); });
    $('#snippet-lang')?.addEventListener('change', event => { state.snippetLang = event.target.value; renderRequest(page, result); });
    $('#snippet-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#snippet-code').textContent); $('#snippet-copy').textContent = 'copied'; }
      catch { $('#snippet-copy').textContent = 'select and copy'; }
    });
  } else {
    body.innerHTML = `<pre>${esc(result.payload)}</pre><p class="hint">The exact bytes the hash covers. Switch the rendering to cwa-messages/v1 to see the same items as a message request.</p>`;
  }
}

export function renderAnswer(page, result) {
  const { state } = page;
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
  const legend = providers.map(p => `<li><strong>${esc(p.label)}</strong>: ${p.configured ? `${esc(p.model)}${p.base_url ? ` at ${esc(p.base_url)}` : ''}${p.fallbacks ? ', refusal fallbacks on' : ''}${p.reasoning_effort ? `, reasoning effort ${esc(p.reasoning_effort)}` : ''}` : `<span class="hint">${esc(p.reason)}</span>`}</li>`).join('');
  const cards = providers.filter(p => state.answers[p.id]).map(p => {
    const a = state.answers[p.id];
    return `<div class="entry">
      <div class="id">${esc(p.label)} · ${esc(a.model ?? p.model)}${a.usage ? ` · ${a.usage.input_tokens} in / ${a.usage.output_tokens} out` : ''}${a.durationMs ? ` · ${a.durationMs} ms` : ''}${a.stop_reason ? ` · stop: ${esc(a.stop_reason)}` : ''}</div>
      ${a.error ? `<div class="outcome bad">${esc(a.error)}</div>` : ''}
      ${a.stop_details ? `<div class="outcome bad">refusal: ${esc(a.stop_details.category ?? '')} ${esc(a.stop_details.explanation ?? '')}</div>` : ''}
      ${a.fallbacks?.length ? `<p class="hint">${esc(a.fallbacks.join('; '))}</p>` : ''}
      ${a.tool_calls?.length ? `<h3>Tool calls requested</h3><pre>${esc(JSON.stringify(a.tool_calls, null, 2))}</pre><p class="hint">Not executed: this stage has no tool loop.</p>` : ''}
      ${a.text ? `<div class="answer-text">${esc(a.text)}</div>` : a.request && !a.error ? `<p class="hint">No answer text${a.stop_reason === 'length' ? `: the model stopped at <span class="mono">length</span> after ${a.usage?.output_tokens ?? '?'} output tokens, the route's reserved_output. A reasoning model spends that budget thinking first; set a lower reasoning effort in .env, or reserve more output on the route.` : '.'}</p>` : ''}
      ${a.reasoning ? `<details><summary>reasoning (${a.reasoning.length} characters)</summary><div class="snippet">${esc(a.reasoning)}</div></details>` : ''}
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
      state.sending = state.providers.find(p => p.id === id)?.label ?? id; renderAnswer(page, result);
      try {
        state.answers[id] = await postJson('/api/answer', { provider: id, payload: result.payload, reserved_output: state.response.snapshot.budget.reserved_output });
      } catch (error) { state.answers[id] = { error: error.message }; }
    }
    state.sending = null; renderAnswer(page, result);
  };
  $('#send')?.addEventListener('click', () => send([state.provider]));
  $('#send-all')?.addEventListener('click', () => send(configured.map(p => p.id)));
  $('#recheck')?.addEventListener('click', async () => { state.providers = await page.api('/api/providers'); renderAnswer(page, result); });
}
