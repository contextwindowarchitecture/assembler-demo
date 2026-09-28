// The chrome every stage page shares: the talk-mode toggle and the instruments row it folds. Presentation only:
// nothing here reads a snapshot or a trace.
import { $ } from './format.js';

const TALK_KEY = 'cwa-demo-talk';

/** Talk mode: larger type for a projector, the instruments folded behind one line. Remembered per browser. */
function initTalkMode() {
  const button = $('#talk');
  if (!button) return;
  let on = false;
  try { on = localStorage.getItem(TALK_KEY) === '1'; } catch { /* storage may be unavailable; the toggle still works for the session */ }
  const apply = () => {
    if (on) document.documentElement.dataset.talk = '1'; else delete document.documentElement.dataset.talk;
    button.setAttribute('aria-pressed', String(on));
  };
  apply();
  button.addEventListener('click', () => {
    on = !on;
    try { localStorage.setItem(TALK_KEY, on ? '1' : '0'); } catch { /* same */ }
    apply();
  });
}

/** In talk mode the controls are hidden until the one-line summary is clicked. */
function initInstruments() {
  const toggle = $('#instruments-toggle');
  const row = $('#instruments');
  if (!toggle || !row) return;
  toggle.addEventListener('click', () => {
    const open = row.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

export function initChrome() {
  initTalkMode();
  initInstruments();
}

/** The one line that stands for the instruments while they are folded. */
export function setInstrumentsSummary(text) {
  const summary = $('#instruments-summary');
  if (summary) summary.textContent = text;
}
