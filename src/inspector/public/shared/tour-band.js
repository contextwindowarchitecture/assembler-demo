// The guided tour's band: the inverse strip fixed over the page (a rail beside it, or a dock along its foot) that walks
// a visitor through a stage, one stop at a time. A stop selects a step (or a run and a turn) through the page's own
// adapter, outlines what it talks about, and says where to look, what the assembler did and why it matters. The copy's
// numbers and ids are filled from the trace and the snapshot the page is showing (tour.js); the band formats them and
// decides nothing.
import { $, esc, reasonChip, tag, url, words } from './format.js';
import { backIndex, fill, nextIndex, parseTourState, progress, tourKey, tourSearch } from './tour.js';

let active = null; // the running tour's controller, or null
/** Whether a tour is running: the page's own arrow keys yield to it while one is. */
export const touring = () => Boolean(active?.index);

const prose = text => esc(text).replace(/`([^`]+)`/g, '<span class="mono">$1</span>');
const isRule = code => /^R-\d+$/.test(code);

/**
 * Start the band on a stage page. `adapter` is the page's side of the tour:
 *   go(at, set) selects the stop's step or turn with its settings and resolves once the page has drawn it;
 *   sources() is what the copy's placeholders read ({ meta, snapshot, trace, ... , configured });
 *   label(at) names a step or turn for the band's meta line and the Next button.
 */
export function initTour({ stage, stops, adapter, reasonText }) {
  const band = $('#tour');
  const toggle = $('#tour-toggle');
  if (!band || !stops.length) return;
  const inviteKey = `cwa-demo-tour-invite-${stage}`;
  const tour = { index: null, busy: false };
  active = tour;
  if (toggle) toggle.hidden = false;
  // The page makes room for the band: beside the rail, under the dock. The dock's height changes with the stop, so it is
  // measured and kept on <html>, as chrome.js keeps the pinned block's.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => document.documentElement.style.setProperty('--tour-h', `${band.offsetHeight}px`)).observe(band);
  }

  const stopAt = index => stops[index - 1];
  const target = () => (tour.index ? stopAt(tour.index).target : null);
  const find = key => document.querySelector(`[data-tour="${CSS.escape(key)}"]`);

  /** Outline what the stop points at and flag it with the stop's number; the columns redraw often, so this runs again
   * after every redraw. */
  function mark() {
    const key = target();
    for (const el of document.querySelectorAll('.tour-target')) {
      if (el.dataset.tour !== key) { el.classList.remove('tour-target'); delete el.dataset.tourStop; }
    }
    const el = key ? find(key) : null;
    if (el) { el.classList.add('tour-target'); el.dataset.tourStop = String(tour.index); }
  }
  new MutationObserver(() => { if (tour.index) mark(); }).observe(document.body, { childList: true, subtree: true });

  function setUrl(index) {
    history.replaceState(null, '', `${location.pathname}${tourSearch(location.search, index)}${location.hash}`);
  }

  function copyFor(stop) {
    const sources = adapter.sources();
    const text = { ...stop, ...(stop.noProvider && !sources.configured ? stop.noProvider : {}) };
    const filled = key => prose(fill(text[key], sources).text);
    return { title: filled('title'), look: filled('look'), what: filled('what'), why: filled('why') };
  }

  function draw() {
    const stop = stopAt(tour.index);
    const copy = copyFor(stop);
    const next = tour.index < stops.length ? stopAt(tour.index + 1) : null;
    const moves = next && JSON.stringify(next.at) !== JSON.stringify(stop.at);
    const proves = stop.proves.length ? `<div class="tour-proves"><span class="label">Proves</span>${stop.proves.map(code =>
      isRule(code) ? tag(code, 'line code') : reasonChip(code, 'bad code', reasonText(code))).join('')}</div>` : '';
    const forward = next
      ? `<button type="button" class="primary" id="tour-next">${esc(stop.next ?? (moves ? `Next: ${adapter.label(next.at)}` : 'Next'))} →</button>`
      : stop.onward ? `<a class="btn" href="${esc(url(stop.onward.href))}">${esc(stop.onward.label)} →</a>` : '';
    band.classList.remove('invite');
    band.innerHTML = `
      <div class="tour-head">
        <span class="kicker">Tour · ${esc(stage)} · ${tour.index} of ${stops.length}</span>
        <span class="label">${esc(adapter.label(stop.at))}</span>
        <span class="tour-progress" aria-hidden="true">${progress(tour.index, stops.length).map(state => `<i class="${state}"></i>`).join('')}</span>
      </div>
      <h2 class="tour-title">${copy.title}</h2>
      <div class="tour-lines">
        <div class="tour-line"><div class="label">Look at</div><p>${copy.look}</p></div>
        <div class="tour-line"><div class="label">What you see</div><p>${copy.what}</p></div>
        <div class="tour-line"><div class="label">Why it matters</div><p>${copy.why}</p></div>
      </div>
      ${proves}
      <div class="tour-nav"><button type="button" id="tour-back"${tour.index === 1 ? ' disabled' : ''}>← Back</button>${forward}
        <button type="button" id="tour-leave" title="Esc">${next ? 'Leave the tour' : 'Finish the tour'}</button>
        <span class="tour-keys" aria-hidden="true">← → · Esc</span></div>`;
    $('#tour-back').addEventListener('click', () => go(backIndex(stops, tour.index)));
    $('#tour-next')?.addEventListener('click', () => go(nextIndex(stops, tour.index)));
    $('#tour-leave').addEventListener('click', leave);
  }

  function invite() {
    let dismissed = false;
    try { dismissed = localStorage.getItem(inviteKey) === '1'; } catch { /* storage may be unavailable; the invite shows */ }
    if (dismissed) { band.hidden = true; band.innerHTML = ''; return; }
    band.hidden = false;
    band.classList.add('invite');
    band.innerHTML = `
      <div class="tour-invite">
        <span class="kicker">Guided tour · ${esc(stage)} stage</span>
        <p>New here? ${stops.length} stops walk you through what this stage proves: each one sets the page for you, points at the place to look and says why it matters. No model is needed.</p>
        <div class="tour-nav"><button type="button" class="primary" id="tour-start">Start the tour →</button><button type="button" id="tour-dismiss">Not now</button></div>
      </div>`;
    $('#tour-start').addEventListener('click', () => go(1));
    $('#tour-dismiss').addEventListener('click', () => {
      try { localStorage.setItem(inviteKey, '1'); } catch { /* the invite closes for this visit regardless */ }
      band.hidden = true; band.innerHTML = '';
    });
  }

  async function go(index) {
    if (tour.busy) return;
    tour.busy = true;
    tour.index = index;
    toggle?.setAttribute('aria-pressed', 'true');
    document.documentElement.dataset.touring = '1';
    const stop = stopAt(index);
    try { await adapter.go(stop.at, stop.set ?? {}); } finally { tour.busy = false; }
    if (tour.index !== index) return;
    // A stop that points into the instruments (the advanced page's replay button) unfolds them; the others fold them.
    const open = Boolean(stop.set?.instruments);
    $('#instruments')?.classList.toggle('open', open);
    $('#instruments-toggle')?.setAttribute('aria-expanded', String(open));
    setUrl(index);
    band.hidden = false;
    draw();
    mark();
    // The pinned block's height changes with the band, so scroll once the new height has been measured.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = find(stop.target);
      if (el && !el.closest('.top')) el.scrollIntoView({ block: 'start' });
    }));
  }

  function leave() {
    tour.index = null;
    toggle?.setAttribute('aria-pressed', 'false');
    delete document.documentElement.dataset.touring;
    setUrl(null);
    mark();
    try { localStorage.setItem(inviteKey, '1'); } catch { /* same */ }
    band.hidden = true; band.innerHTML = '';
  }

  toggle?.addEventListener('click', () => (tour.index ? leave() : go(1)));
  document.addEventListener('keydown', event => {
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (event.key === 'Escape' && !$('#glossary')?.hidden) return; // Esc closes the glossary first
    const action = tourKey(event.key, Boolean(tour.index));
    if (!action) return;
    event.preventDefault();
    if (action === 'next') go(nextIndex(stops, tour.index));
    if (action === 'back') go(backIndex(stops, tour.index));
    if (action === 'leave') leave();
  });

  const wanted = parseTourState(location.search);
  if (wanted) go(Math.min(wanted, stops.length)); else invite();
}

/**
 * The adapter a stage of frozen steps gives the band (basic, intermediate): select a stop's step with its rendering and
 * assembler, and hand the copy the step's metadata, snapshot and trace. A stop lands with the step before it shown
 * first when that is not already the step on screen, so the delta strip compares with that step. `prepare` sets what
 * else a page needs for a tour (the intermediate page's replay mode) and says whether it changed anything.
 */
export function stepTourAdapter({ stage, state, current, selectScenario, shown, prepare = () => false }) {
  return {
    async go(at, set) {
      const id = `${stage}/${at.step}`;
      const variant = set.variant ?? 'fixture';
      const assembler = set.assembler ?? 'all';
      const index = state.scenarios.findIndex(s => s.id === id);
      const showing = state.scenarios.findIndex(s => s.id === state.scenario);
      const changed = prepare();
      const settled = !changed && showing === index && state.variant === variant && state.assembler === assembler && state.budget === null && state.response;
      state.variant = variant; $('#variant').value = variant;
      state.assembler = assembler; $('#assembler').value = assembler;
      if (settled) return;
      if (index > 0 && showing !== index && showing !== index - 1) await selectScenario(state.scenarios[index - 1].id);
      await selectScenario(id);
    },
    sources: () => ({
      meta: current()?.meta, snapshot: state.response?.snapshot, trace: shown()?.trace, result: shown(),
      configured: state.providers.filter(p => p.configured).length,
    }),
    label: at => {
      const scenario = state.scenarios.find(s => s.id === `${stage}/${at.step}`);
      return scenario ? `step ${scenario.meta.step} · ${words(scenario.meta.id)}` : at.step;
    },
  };
}
