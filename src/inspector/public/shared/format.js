// Small formatting helpers every page shares. Nothing here decides anything.
export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** A chip: the one shape badges, tags and statuses share. `cls` picks the outcome color (ok, info, bad, warn, gray, line). */
export const tag = (text, cls = '', title = '') => `<span class="chip ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
/** A reason code as a chip that opens the glossary at it: a button carrying `data-reason`. The code defaults to the text. */
export const reasonChip = (text, cls = '', title = '', code = text) => `<button type="button" class="chip ${cls}" data-reason="${esc(code)}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</button>`;
export const short = value => String(value).replace(/^\d+-/, '');
/** A step id as its pill reads it: `02-stale-and-foreign` is "stale and foreign". */
export const words = value => short(value).replace(/-/g, ' ');
export const when = iso => (iso ? iso.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1Z') : '');
/** A date-time without its seconds, for a card's tertiary line: `2026-09-28T13:59:30Z` is "2026-09-28 13:59". */
export const brief = iso => (iso ? iso.replace('T', ' ').replace(/(:\d\d):\d\d(\.\d+)?Z$/, '$1') : '');

/** The app's root, derived from this module's own URL, so it carries any path prefix a proxy put in front of the
 * inspector (the module lives at <root>/shared/format.js). Every URL a script builds starts from it. */
export const ROOT = new URL('../', import.meta.url);
/** An app-root path (`/api/state` or `api/state`, `basic/`) as an absolute URL under ROOT. */
export const url = path => new URL(String(path).replace(/^\//, ''), ROOT).href;

export async function api(path, options) {
  const res = await fetch(url(path), options);
  const body = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

export const postJson = (path, body) => api(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/** The registry text for a reason code, from the contract the page loaded. */
export function reasonTextFor(contract) {
  return code => {
    const base = String(code).startsWith('missing_field:') ? 'missing_field:<name>' : code;
    const reason = contract?.reasons?.[base];
    return reason ? `${reason.rule}: ${reason.text}` : '';
  };
}

/** The masthead's stage rail: every stage, numbered, the current one in ink. */
export function stageNav(current) {
  const stages = [['basic', 'Basic'], ['intermediate', 'Intermediate'], ['advanced', 'Advanced']];
  return `<nav class="stages" aria-label="Stages">${stages.map(([id, label], i) =>
    `<a href="${url(`${id}/`)}" class="stage${id === current ? ' active' : ''}"${id === current ? ' aria-current="page"' : ''}><span class="num">${i + 1}</span>${label}</a>`).join('')}</nav>`;
}
