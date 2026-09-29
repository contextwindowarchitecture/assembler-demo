// The glossary panel: the words the spec and the demo use, behind the masthead button, on every page. The entries
// are data in terms.js; a reason code, when one is asked for, is shown from the contract the server serves. The page
// stays where it is while the panel is open. Presentation only: nothing here decides anything.
import { $, api, esc } from './format.js';
import { TERMS, slugOf } from './terms.js';

/** The entries whose term, aliases or text contain the query, case-insensitively; every entry for no query. */
export function filterTerms(entries, query) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return entries;
  return entries.filter(entry => [entry.term, ...(entry.aliases ?? []), entry.text].some(text => String(text).toLowerCase().includes(needle)));
}

/** A reason code as the contract records it, or null. `missing_field:<x>` shares the registry's `<name>` entry. */
export function reasonEntry(contract, code) {
  if (!contract?.reasons) return null;
  const base = String(code).startsWith('missing_field:') ? 'missing_field:<name>' : String(code);
  const reason = contract.reasons[base];
  return reason ? { code: String(code), rule: reason.rule, kind: reason.kind, text: reason.text } : null;
}

const KINDS = [['spec', 'The spec'], ['demo', 'This demo']];

function entryHtml(entry, hit) {
  const slug = slugOf(entry.term);
  const ids = (entry.ids ?? []).map(id => `<span class="mono">${esc(id)}</span>`).join('');
  const rules = (entry.rules ?? []).map(rule => `<span class="rule">${esc(rule)}</span>`).join('');
  const see = (entry.see ?? []).map(term => `<a href="#term-${slugOf(term)}" data-term="${slugOf(term)}">${esc(term)} →</a>`).join('');
  return `<div class="term${hit === slug ? ' hit' : ''}" id="term-${slug}">
    <div class="t">${esc(entry.term)}${entry.aliases?.length ? `<span class="also">${esc(entry.aliases.join(' · '))}</span>` : ''}</div>
    ${ids ? `<div class="ids">${ids}</div>` : ''}
    <p>${esc(entry.text)}</p>
    ${rules || see ? `<div class="see">${rules}${see}</div>` : ''}
  </div>`;
}

/** The panel's body: a reason card when one is asked for, then the entries grouped by kind, each with its anchor. */
export function renderGlossary(entries, { reason = null, hit = null } = {}) {
  const card = reason
    ? `<div class="reason"><span class="c">${esc(reason.code)}</span><span class="r"><b>${esc(reason.rule)}</b> · ${esc(reason.kind)}</span><p>${esc(reason.text)}</p></div>`
    : '';
  const groups = KINDS.map(([kind, label]) => {
    const of = entries.filter(entry => entry.kind === kind);
    return of.length ? `<div class="sec">${label}</div>${of.map(entry => entryHtml(entry, hit)).join('')}` : '';
  }).join('');
  return `${card}${groups || '<p class="hint">no term matches</p>'}`;
}

let contractPromise = null;
/** The contract, fetched once when a reason code is first asked for. */
const loadContract = () => (contractPromise ??= api('/api/contract').catch(() => null));

/** Opens and closes the panel, filters it, follows its see-also links, and opens it at a reason code when an element
 * carrying `data-reason` is clicked anywhere on the page. */
export function initGlossary() {
  const panel = $('#glossary');
  const toggle = $('#glossary-toggle');
  if (!panel || !toggle) return;
  const filter = $('#glossary-filter');
  const body = $('#glossary-body');
  let reason = null;
  let hit = null;
  const draw = () => { body.innerHTML = renderGlossary(filterTerms(TERMS, filter.value), { reason, hit }); };
  const setOpen = open => {
    panel.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    if (open) { draw(); filter.focus(); }
  };
  toggle.addEventListener('click', () => {
    if (panel.hidden) { reason = null; hit = null; filter.value = ''; }
    setOpen(panel.hidden);
  });
  $('#glossary-close')?.addEventListener('click', () => setOpen(false));
  filter.addEventListener('input', () => { reason = null; hit = null; draw(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && !panel.hidden) setOpen(false); });
  document.addEventListener('click', async event => {
    const chip = event.target.closest('[data-reason]');
    if (chip) {
      const code = chip.dataset.reason;
      reason = reasonEntry(await loadContract(), code) ?? { code, rule: '', kind: 'not in the registry', text: '' };
      hit = null;
      filter.value = '';
      setOpen(true);
      body.scrollTop = 0;
      return;
    }
    const link = event.target.closest('a[data-term]');
    if (!link || !panel.contains(link)) return;
    event.preventDefault();
    reason = null;
    hit = link.dataset.term;
    filter.value = '';
    draw();
    document.getElementById(`term-${hit}`)?.scrollIntoView({ block: 'start' });
  });
}
