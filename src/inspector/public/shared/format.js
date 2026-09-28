// Small formatting helpers every page shares. Nothing here decides anything.
export const $ = selector => document.querySelector(selector);
export const esc = value => String(value ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const tag = (text, cls = '', title = '') => `<span class="tag ${cls}"${title ? ` title="${esc(title)}"` : ''}>${esc(text)}</span>`;
export const short = value => String(value).replace(/^\d+-/, '');
export const when = iso => (iso ? iso.replace('T', ' ').replace(/(:\d\d)(\.\d+)?Z$/, '$1Z') : '');

export async function api(path, options) {
  const res = await fetch(path, options);
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

/** The header's stage switcher: every stage, the current one marked. */
export function stageNav(current) {
  const stages = [['basic', '/basic/', 'Basic'], ['intermediate', '/intermediate/', 'Intermediate'], ['advanced', null, 'Advanced']];
  return `<nav class="stages" aria-label="Stages">${stages.map(([id, href, label]) =>
    href ? `<a href="${href}" class="${id === current ? 'active' : ''}">${label}</a>` : `<span class="planned" title="not built yet">${label}</span>`).join('')}</nav>`;
}
