// The four columns every stage shows, as functions of a page: candidate context, CWA decisions, the outbound
// request (with the SDK snippets), and the model answer. A page passes itself in; the panels read its state and
// call back into it. They format; they never decide: every status, count and meter here is read from the trace.
import { statusChange } from './delta.js';
import { $, brief, esc, postJson, reasonChip, tag } from './format.js';

/** The result a page's columns show: the chosen assembler's, or the first judged one when all ran. */
export function shownResult(response) {
  const results = response?.results ?? [];
  return results.find(r => r.outcome === 'assembled' || r.outcome === 'refused') ?? results.find(r => r.outcome === 'rejected') ?? results[0] ?? null;
}

/** A candidate's outcome, read from the trace: an assembler-stage exclusion, else a compressed row, else an included row. */
export function statusOf(item, trace) {
  if (!trace) return { kind: 'none' };
  const excluded = trace.excluded.find(row => row.item_id === item.id && row.stage === 'assembler');
  if (excluded) return { kind: 'excluded', reason: excluded.reason, stage: excluded.stage };
  const compressed = trace.compressed.find(row => row.item_id === item.id);
  if (compressed) {
    const placed = trace.included.find(row => row.item_id === item.id);
    return { kind: 'compressed', from: compressed.from, to: compressed.to, variant_id: compressed.variant_id, method: compressed.method, tokens: placed?.tokens ?? compressed.to };
  }
  const included = trace.included.find(row => row.item_id === item.id);
  if (included) return { kind: 'included', tokens: included.tokens };
  if (trace.refused.bool) return { kind: 'refused' };
  return { kind: 'unplaced' };
}

function statusChip(status, reasonText) {
  switch (status.kind) {
    case 'excluded': return reasonChip(status.reason, 'bad code', reasonText(status.reason));
    case 'compressed': return tag(`compressed ${status.from} → ${status.to}`, 'info dot', `variant ${status.variant_id} (${status.method})`);
    case 'included': return tag(`included · ${status.tokens} tokens`, 'plane dot');
    case 'refused': return tag('admitted · assembly refused', 'gray dot');
    case 'unplaced': return tag('not placed', 'gray');
    default: return '';
  }
}

const PLANES = { governance: 'gov', state: 'state', evidence: 'evid', interaction: 'inter' };

/** The plane a slot belongs to, as the token suffix the stylesheet names it by (`--p-evid`): the part of the slot id before the dot. */
export function planeOf(slot) {
  return PLANES[String(slot ?? '').split('.')[0]] ?? null;
}

/** The budget meter: of the input tokens used, how many stand for content placed as a summary, and what is free; and
 * one segment per included item, in placement order, coloured by its slot's plane, marked when it went in as a summary. */
export function meterFor(trace, budget) {
  if (!trace?.result) return null;
  const compressed = new Set(trace.compressed.map(row => row.item_id));
  const segments = trace.included.map(row => ({ item_id: row.item_id, slot: row.slot, plane: planeOf(row.slot), tokens: row.tokens, compressed: compressed.has(row.item_id) }));
  const summarised = segments.filter(s => s.compressed).reduce((sum, s) => sum + s.tokens, 0);
  const used = trace.result.input_tokens;
  return { used, budget, placed: used - summarised, summarised, free: Math.max(0, budget - used), segments };
}

/** What each column header says it holds, read from the response the columns show. */
export function columnHeads({ snapshot, result, variant, answers, recorded }) {
  if (!snapshot) return ['', '', '', ''];
  const items = snapshot.batches.reduce((n, b) => n + b.items.length, 0);
  const reported = snapshot.batches.reduce((n, b) => n + b.excluded.length, 0);
  const producers = snapshot.batches.length;
  const candidates = `${items} item${items === 1 ? '' : 's'} from ${producers} producer${producers === 1 ? '' : 's'}${reported ? ` · ${reported} reported excluded` : ''}`;
  const trace = result?.trace ?? null;
  const refused = Boolean(trace?.refused.bool);
  const decisions = !result ? '' : !trace ? result.outcome : refused ? `refused · ${trace.refused.reason}`
    : `${trace.included.length} included · ${trace.compressed.length} compressed · ${trace.excluded.length} excluded`;
  const request = !result ? '' : result.outcome === 'assembled' ? `${snapshot.renderer} · ${trace.result.input_tokens} tokens · hash ${trace.result.hash.slice(0, 8)}…`
    : refused ? 'none: a refusal has no payload' : result.outcome;
  const n = Object.keys(answers ?? {}).length;
  const answer = !result ? '' : refused ? 'nothing to send' : result.outcome !== 'assembled' ? '' : variant !== 'messages' ? 'needs cwa-messages/v1'
    : recorded ? 'recorded' : n ? `${n} answer${n === 1 ? '' : 's'}` : `not sent yet · max_tokens ${snapshot.budget.reserved_output}`;
  return [candidates, decisions, request, answer];
}

/** Write each column's summary line, and mark the columns a refusal never reaches. */
export function renderColumnHeads(page, result) {
  const { state } = page;
  const heads = columnHeads({ snapshot: state.response?.snapshot ?? null, result, variant: state.variant, answers: state.answers, recorded: Boolean(page.recordedAnswer) });
  ['candidates', 'decisions', 'request', 'answer'].forEach((id, i) => { const sub = $(`#${id} .col-sub`); if (sub) sub.textContent = heads[i]; });
  $('.columns')?.classList.toggle('refused', Boolean(result?.trace?.refused.bool));
}

export function renderCandidates(page, result) {
  const { state, reasonText } = page;
  const snapshot = state.response?.snapshot;
  const body = $('#candidates .body');
  if (!snapshot) { body.innerHTML = state.busy ? '<p class="spinner">loading…</p>' : ''; return; }
  const trace = result?.trace ?? null;
  const conflicts = new Map(snapshot.conflicts.flatMap(group => group.items.map(id => [id, group])));
  // The step you came from, when the page kept one: a card whose status changed says what it was.
  const previous = page.previous?.() ?? null;
  const previousIds = previous ? new Set(previous.snapshot.batches.flatMap(b => b.items.map(i => i.id))) : null;
  const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const index = `<div class="pidx" aria-label="Producers">${snapshot.batches.map(batch =>
    `<button type="button" data-producer="${esc(batch.producer.id)}" title="scroll to this producer's batch">${esc(batch.producer.id)} ${batch.items.length}${batch.excluded.length ? `+${batch.excluded.length}` : ''}</button>`).join('')}</div>`;
  body.innerHTML = index + snapshot.batches.map(batch => `
    <div class="producer" id="producer-${esc(batch.producer.id)}">
      <div class="producer-head"><span class="pid">${esc(batch.producer.id)}</span>${tag(batch.producer.kind, 'line')}
        <span class="meta">${plural(batch.items.length, 'item')}${batch.excluded.length ? `, ${batch.excluded.length} reported excluded` : ''}</span></div>
      ${batch.items.map(item => {
        const status = statusOf(item, trace);
        const change = previous ? statusChange(previousIds.has(item.id) ? statusOf(item, previous.trace) : null, status, page.noun ?? 'step') : null;
        const scope = item.scope ? Object.entries(item.scope).map(([k, v]) => `${k}=${v}`).join(' ') : '';
        const group = conflicts.get(item.id);
        const plane = planeOf(item.slot);
        const facts = [`<span class="slot">${esc(item.slot)}</span>`, esc(item.authority), esc(item.trust), item.tier ? `<span title="the item claims this tier">tier ${esc(item.tier)}</span>` : '',
          item.relevance !== undefined ? `rerank ${esc(item.relevance)}` : '', item.injection_risk ? esc(item.injection_risk) : ''].filter(Boolean).join('<span class="sep">·</span>');
        const tert = [`fresh ${brief(item.freshness)}`, item.expires ? `expires ${brief(item.expires)}` : '', scope, item.variants?.length ? plural(item.variants.length, 'variant') : '',
          item.source ? `source ${esc(item.source)}` : ''].filter(Boolean).join(' · ');
        return `<article class="item ${status.kind}" data-tour="candidate:${esc(item.id)}"${plane ? ` style="--plane: var(--p-${plane})"` : ''}>
          <div class="status">${statusChip(status, reasonText)}${change ? tag(change, 'line') : ''}${group ? tag(`conflict ${group.id}`, 'conflict code', `${group.kind} group${group.fact ? ` on fact ${group.fact}` : ''}`) : ''}</div>
          <div class="id">${esc(item.id)}</div>
          <div class="facts">${facts}</div>
          <div class="tert">${tert}</div>
          <details><summary>${esc(item.body.length > 90 ? item.body.slice(0, 90) + '…' : item.body)}</summary><div class="snippet">${esc(item.body)}</div>
            ${(item.variants ?? []).map(v => `<div class="snippet"><strong>${esc(v.id)}</strong> (${esc(v.method)}): ${esc(v.body)}</div>`).join('')}</details>
        </article>`;
      }).join('')}
      ${batch.excluded.map(row => `<article class="item producer-excluded" data-tour="candidate:${esc(row.item_id)}">
        <div class="status">${reasonChip(`${row.reason} · producer`, 'gray code', reasonText(row.reason), row.reason)}${row.duplicate_of ? `<span class="meta">duplicate of ${esc(row.duplicate_of)}</span>` : ''}${row.superseded_by ? `<span class="meta">superseded by ${esc(row.superseded_by)}</span>` : ''}</div>
        <div class="id">${esc(row.item_id)}</div>
        <div class="tert">reported by the producer; body never sent</div></article>`).join('')}
    </div>`).join('');
  for (const button of body.querySelectorAll('.pidx button')) {
    button.addEventListener('click', () => document.getElementById(`producer-${button.dataset.producer}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' }));
  }
}

export function renderDecisions(page, result) {
  const { state, reasonText } = page;
  const body = $('#decisions .body');
  if (!result) { body.innerHTML = state.busy ? '<p class="spinner">assembling…</p>' : ''; return; }
  if (!result.trace) {
    body.innerHTML = `<div class="outcome bad"><div class="head"><span class="title">${esc(result.outcome)}</span><span class="mono">${esc(result.assembler)}</span></div><div class="ofoot">${esc(result.detail)}</div></div>
      <p class="hint">${result.outcome === 'rejected' ? 'The snapshot failed its schemas or a snapshot check, so there is no assembly and no trace (R-17). This is the application\'s error in building the snapshot.' : ''}</p>`;
    return;
  }
  const { trace } = result;
  const snapshot = state.response.snapshot;
  const meter = meterFor(trace, snapshot.budget.input);
  const pct = n => Math.min(100, Math.round(100 * n / Math.max(1, snapshot.budget.input)));
  const outcome = trace.refused.bool
    ? `<div class="outcome bad" data-tour="decisions:outcome"><div class="head"><span class="title">Refused</span><span class="mono">${esc(trace.refused.reason)}</span></div>
        <div class="ofoot"><span>${esc(reasonText(trace.refused.reason))}</span></div>
        <div class="ofoot mono" data-tour="decisions:recovery">result: null · nothing included · admission decisions kept${trace.recovery ? ` · recovery: ${esc(trace.recovery.action)}${trace.recovery.detail ? ` (${esc(trace.recovery.detail)})` : ''}` : ''}</div></div>`
    : `<div class="outcome ok" data-tour="decisions:outcome"><div class="head"><span class="title">Assembled</span><span class="mono">${trace.result.input_tokens} of ${snapshot.budget.input} input tokens</span></div>
        <div class="meter" title="${meter.used} used, ${meter.summarised} of them as summaries; ${meter.free} free">${meter.segments.map(s => `<i class="segment${s.compressed ? ' compressed' : ''}" style="flex-basis: ${pct(s.tokens)}%${s.plane ? `; --plane: var(--p-${s.plane})` : ''}" title="${esc(s.item_id)} · ${esc(s.slot)} · ${s.tokens} tokens${s.compressed ? ' as a summary' : ''}"></i>`).join('')}</div>
        <div class="ofoot"><span>${trace.included.length} included</span><span>${trace.compressed.length} compressed</span><span>${trace.excluded.length} excluded</span>${meter.summarised ? `<span>${meter.summarised} tokens as summaries</span>` : ''}<span class="right">hash <span class="mono">${esc(trace.result.hash.slice(0, 12))}…</span></span></div></div>`;
  const conflicts = trace.conflicts.length ? `<div class="part" data-tour="decisions:conflicts"><div class="sec">Conflicts</div><table><tr><th>group</th><th>kind</th><th>resolution</th><th>winner</th></tr>
    ${trace.conflicts.map(c => `<tr><td class="m">${esc(c.group_id)}</td><td>${esc(c.kind)}</td><td>${esc(c.resolution)} <span class="hint">${esc(c.decided_by)}</span></td><td class="m">${esc(c.winner ?? '—')}</td></tr>`).join('')}</table></div>` : '';
  const compressed = trace.compressed.length ? `<div class="part" data-tour="decisions:compressed"><div class="sec">Compressed</div><table><tr><th>item · variant</th><th class="num">from → to</th></tr>
    ${trace.compressed.map(row => `<tr><td class="m">${esc(row.item_id)}<div class="tags hint">${esc(row.variant_id)} · ${esc(row.method)}</div></td><td class="num">${row.from} → ${row.to}</td></tr>`).join('')}</table></div>` : '';
  const excluded = trace.excluded.length ? `<div class="part" data-tour="decisions:excluded"><div class="sec">Excluded</div><table><tr><th>item · reason · stage</th></tr>
    ${trace.excluded.map(row => `<tr><td class="m">${esc(row.item_id)}<div class="tags">${reasonChip(row.reason, row.stage === 'producer' ? 'gray code' : 'bad code', reasonText(row.reason))}<span class="hint">${esc(row.stage)}${row.duplicate_of ? ` · of ${esc(row.duplicate_of)}` : ''}${row.superseded_by ? ` · by ${esc(row.superseded_by)}` : ''}</span></div></td></tr>`).join('')}</table></div>`
    : `<div class="part" data-tour="decisions:excluded"><div class="sec">Excluded</div><p class="hint">nothing</p></div>`;
  const included = trace.included.length ? `<div class="sec">Included (placement order)</div><table><tr><th>item · slot</th><th class="num">tokens</th></tr>
    ${trace.included.map(row => `<tr><td class="m">${esc(row.item_id)}<div class="tags hint">${esc(row.slot)}</div></td><td class="num">${row.tokens}</td></tr>`).join('')}</table>` : '';
  const codes = [...new Set([...trace.excluded.map(r => r.reason), ...(trace.refused.reason ? [trace.refused.reason] : [])])];
  const reasons = codes.length ? `<div class="part" data-tour="decisions:reasons"><div class="sec">Reason codes in this assembly</div><div class="reasons">${codes.map(code => {
    const text = reasonText(code) || 'not in the registry';
    const [rule, ...rest] = text.split(': ');
    return `<span class="c">${esc(code)}</span><span class="r">${rest.length ? `<b>${esc(rule)}</b> ${esc(rest.join(': '))}` : esc(text)}</span>`;
  }).join('')}</div></div>` : '';
  const defaults = trace.defaults_filled.length ? `<p class="hint">${trace.defaults_filled.length} default${trace.defaults_filled.length === 1 ? '' : 's'} filled (R-3)</p>` : '<p class="hint">no defaults filled: every producer declared its policy fields</p>';
  body.innerHTML = `${outcome}${conflicts}${compressed}${excluded}${included}${reasons}${defaults}
    <div class="part" data-tour="decisions:context"><div class="sec">Context</div><div class="kv">
      <span class="k">assembler</span><span class="v">${esc(result.assembler)} · ${result.durationMs} ms</span>
      <span class="k">profile</span><span class="v">${esc(trace.profile.id)} v${trace.profile.version}</span>
      <span class="k">route policy</span><span class="v">${esc(trace.context.route_policy_version)}</span>
      <span class="k">tokenizer</span><span class="v">${esc(trace.context.tokenizer)}</span>
      <span class="k">renderer</span><span class="v">${esc(trace.context.renderer)}</span>
      <span class="k">assembly time</span><span class="v">${esc(trace.context.assembly_time)}</span>
      <span class="k">snapshot digest</span><span class="v">${esc(trace.context.snapshot_digest)}</span>
      ${trace.result ? `<span class="k">payload hash</span><span class="v">${esc(trace.result.hash)}</span>` : ''}
    </div></div>`;
}

const SNIPPET_TABS = [['assemble', 'Assemble (CWA)'], ['local', 'OpenAI SDK · local'], ['openai', 'OpenAI SDK'], ['anthropic', 'Anthropic SDK']];

function renderSnippets(state) {
  const snippets = state.snippets;
  if (!snippets) return '<div class="part" data-tour="snippets"><div class="sec">Use it in your code</div><p class="spinner">building snippets…</p></div>';
  if (snippets.error) return `<div class="part" data-tour="snippets"><div class="sec">Use it in your code</div><p class="hint">${esc(snippets.error)}</p></div>`;
  const tabs = SNIPPET_TABS.filter(([id]) => snippets[id]);
  if (!tabs.some(([id]) => id === state.snippetTab)) state.snippetTab = tabs[0][0];
  const code = snippets[state.snippetTab]?.[state.snippetLang] ?? '';
  const seg = (id, options, current) => `<div class="seg" id="${id}">${options.map(([value, label]) => `<button type="button" data-value="${value}" aria-pressed="${value === current}">${esc(label)}</button>`).join('')}</div>`;
  return `<div class="part" data-tour="snippets"><div class="sec">Use it in your code</div>
    <div class="sendrow">
      ${seg('snippet-tab', tabs, state.snippetTab)}
      ${seg('snippet-lang', [['typescript', 'TypeScript'], ['python', 'Python']], state.snippetLang)}
      <button id="snippet-copy" type="button" class="right">copy</button>
    </div>
    <pre class="snippet-code" id="snippet-code">${esc(code)}</pre>
    <p class="hint">The object in the call is the request the provider sends, built by the same code. Copy it into your application: the assembler's payload is all it takes.</p></div>`;
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
    body.innerHTML = `<div class="norequest" data-tour="request:refused"><div class="big">No model request</div><p>The assembly was refused with <span class="mono">${esc(result.trace.refused.reason)}</span>, so there is no payload to send (R-17). Nothing reaches the model.</p><div class="mono">payload: null</div></div>
      <p class="hint">The application gets a reason and decides: raise the budget, narrow retrieval, or stop.</p>`;
    return;
  }
  if (result.outcome !== 'assembled') { body.innerHTML = `<p class="hint">${esc(result.outcome)}: ${esc(result.detail)}</p>`; return; }
  if (state.variant === 'messages') {
    let ir;
    try { ir = JSON.parse(result.payload); } catch { body.innerHTML = `<pre>${esc(result.payload)}</pre>`; return; }
    const toolName = text => { try { return JSON.parse(text).name ?? null; } catch { return null; } };
    body.innerHTML = `
      <div class="sec">system · ${ir.system.length}</div>
      ${ir.system.map(e => `<div class="entry"${e.conflict ? ` data-tour="request:conflict"` : ''}><div class="id">${esc(e.id)}${e.conflict ? tag(`conflict ${e.conflict}`, 'conflict code xs', 'surfaced: both instructions stay, marked') : ''}</div>${esc(e.text)}</div>`).join('') || '<p class="hint">none</p>'}
      <div class="sec">tools · ${ir.tools.length}${ir.tools.length ? ' · from the grant' : ''}</div>
      ${ir.tools.length ? `<div class="entry"><div class="tools">${ir.tools.map(e => tag(toolName(e.text) ?? e.id, 'line code', e.id)).join('')}</div>${ir.tools.map(e => `<details><summary class="hint">${esc(e.id)}</summary><pre>${esc(e.text)}</pre></details>`).join('')}</div>` : '<p class="hint">none: no capabilities are granted on this route</p>'}
      <div class="sec">messages · ${ir.messages.length}${ir.messages.map(m => ` · role ${esc(m.role)}`).join('')}</div>
      ${ir.messages.map(m => `<pre>${esc(m.content)}</pre>`).join('')}
      <p class="hint">Prior turns stay inside the one user message as a transcript; only the query is the live turn (R-7). The bytes above are the RFC 8785 form the hash covers.</p>
      ${renderSnippets(state)}`;
    for (const [id, key] of [['snippet-tab', 'snippetTab'], ['snippet-lang', 'snippetLang']]) {
      $(`#${id}`)?.addEventListener('click', event => { const value = event.target.closest('button')?.dataset.value; if (value) { state[key] = value; renderRequest(page, result); } });
    }
    $('#snippet-copy')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('#snippet-code').textContent); $('#snippet-copy').textContent = 'copied'; }
      catch { $('#snippet-copy').textContent = 'select and copy'; }
    });
  } else {
    body.innerHTML = `<pre>${esc(result.payload)}</pre><p class="hint">The exact bytes the hash covers. Switch the rendering to cwa-messages/v1 to see the same items as a message request.</p>`;
  }
}

function answerMeta(a, label) {
  return `${esc(label)}${a.usage ? ` · ${a.usage.input_tokens} in / ${a.usage.output_tokens} out` : ''}${a.durationMs ? ` · ${a.durationMs} ms` : ''}${a.stop_reason ? ` · stop: ${esc(a.stop_reason)}` : ''}`;
}

export function renderAnswer(page, result) {
  const { state } = page;
  const body = $('#answer .body');
  if (!result || result.outcome !== 'assembled') {
    body.innerHTML = result?.outcome === 'refused'
      ? '<div class="empty"><div class="big">Nothing to send</div><div class="hint">The provider adapter takes a payload and nothing else. A refused assembly has none, so no provider, no button, no call.</div></div>' : '';
    return;
  }
  if (state.variant !== 'messages') {
    body.innerHTML = '<div class="empty"><div class="big">Fixture rendering</div><div class="hint">Switch the rendering to cwa-messages/v1 to send this assembly to a model. The fixture rendering exists for the byte-exact comparison.</div></div>';
    return;
  }
  if (page.recordedAnswer) {
    // A recorded run: the model's response for this turn, as it was captured, and nothing to send.
    const a = page.recordedAnswer(result);
    body.innerHTML = a ? `<div class="entry" data-tour="recorded-answer">
      <div class="id">${answerMeta(a, `${a.label ?? 'recorded'} · ${a.model ?? ''}`)}</div>
      ${(a.tool_calls ?? []).length ? `<div class="sec">Tool request${a.tool_calls.length === 1 ? '' : 's'}</div>${a.tool_calls.map(c => `<div class="sendrow">${tag(c.name, 'line code')}<span class="mono">${esc(JSON.stringify(c.arguments))}</span></div>`).join('')}` : ''}
      ${a.text ? `<div class="answer-text">${esc(a.text)}</div>` : '<p class="hint">no answer text this turn</p>'}
      ${a.reasoning ? `<details><summary class="hint">reasoning (${a.reasoning.length} characters)</summary><div class="snippet">${esc(a.reasoning)}</div></details>` : ''}
      ${a.request ? `<details><summary class="hint">outbound request (exact)</summary><pre>${esc(JSON.stringify(a.request, null, 2))}</pre></details>` : ''}
    </div><p class="hint">A recorded run shows the response as captured; nothing here is sent again.</p>` : '<p class="hint">no model call this turn</p>';
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
      <div class="id">${answerMeta(a, `${p.label} · ${a.model ?? p.model}`)}</div>
      ${a.error ? `<div class="outcome bad"><div class="ofoot">${esc(a.error)}</div></div>` : ''}
      ${a.stop_details ? `<div class="outcome bad"><div class="ofoot">refusal: ${esc(a.stop_details.category ?? '')} ${esc(a.stop_details.explanation ?? '')}</div></div>` : ''}
      ${a.fallbacks?.length ? `<p class="hint">${esc(a.fallbacks.join('; '))}</p>` : ''}
      ${a.tool_calls?.length ? `<div class="sec">Tool calls requested</div><pre>${esc(JSON.stringify(a.tool_calls, null, 2))}</pre><p class="hint">Not executed: this stage has no tool loop.</p>` : ''}
      ${a.text ? `<div class="answer-text">${esc(a.text)}</div>` : a.request && !a.error ? `<p class="hint">No answer text${a.stop_reason === 'length' ? `: the model stopped at <span class="mono">length</span> after ${a.usage?.output_tokens ?? '?'} output tokens, the route's reserved_output. A reasoning model spends that budget thinking first; set a lower reasoning effort in .env, or reserve more output on the route.` : '.'}</p>` : ''}
      ${a.reasoning ? `<details><summary class="hint">reasoning (${a.reasoning.length} characters)</summary><div class="snippet">${esc(a.reasoning)}</div></details>` : ''}
      ${a.request ? `<details><summary class="hint">outbound request (exact)</summary><pre>${esc(JSON.stringify(a.request, null, 2))}</pre></details>` : ''}
    </div>`;
  }).join('');
  const empty = !cards && !state.sending
    ? `<div class="empty"><div class="big">No answer yet</div><div class="hint">${configured.length ? 'Send puts this exact request through the official SDK. The answer appears here with the captured request beneath it, so what you read is what was sent.' : 'No provider is configured: see the providers below for the variable each one needs, then re-check.'}</div></div>` : '';
  body.innerHTML = `
    <div class="sendrow">
      <span class="select"><select id="provider" ${configured.length ? '' : 'disabled'}>${options}</select></span>
      <button class="primary" id="send" ${!configured.length || state.sending ? 'disabled' : ''}>Send</button>
      <button id="send-all" ${configured.length < 2 || state.sending ? 'disabled' : ''} title="the same request to every configured provider">Send to all</button>
      <button id="recheck" title="ask again which providers are configured, for example after starting a local model server">re-check</button>
    </div>
    ${state.sending ? `<p class="spinner">asking ${esc(state.sending)}…</p>` : ''}
    <p class="hint">max_tokens is the route's reserved_output; the request is captured before it is sent.</p>
    ${empty}${cards}
    <details><summary class="hint">providers</summary><ul class="hint">${legend}</ul></details>`;
  $('#provider')?.addEventListener('change', event => { state.provider = event.target.value; });
  const send = async ids => {
    for (const id of ids) {
      state.sending = state.providers.find(p => p.id === id)?.label ?? id; renderAnswer(page, result);
      try {
        state.answers[id] = await postJson('/api/answer', { provider: id, payload: result.payload, reserved_output: state.response.snapshot.budget.reserved_output });
      } catch (error) { state.answers[id] = { error: error.message }; }
    }
    state.sending = null; renderAnswer(page, result); renderColumnHeads(page, result);
  };
  $('#send')?.addEventListener('click', () => send([state.provider]));
  $('#send-all')?.addEventListener('click', () => send(configured.map(p => p.id)));
  $('#recheck')?.addEventListener('click', async () => { state.providers = await page.api('/api/providers'); renderAnswer(page, result); });
}
