// The chrome every page shares: the theme toggle, the talk-mode toggle and the instruments row it folds.
// Presentation only: nothing here reads a snapshot or a trace.
import { $ } from './format.js';

const TALK_KEY = 'cwa-demo-talk';
const THEME_KEY = 'cwa-theme';

/** The theme a stored choice resolves to: the website's rule, light unless dark was chosen. */
export const resolveTheme = stored => (stored === 'dark' ? 'dark' : 'light');
/** What the toggle says: the theme you would switch to, in the website's lowercase. */
export const themeLabel = theme => (theme === 'dark' ? 'light' : 'dark');

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

/** The website's theme: `data-theme` on <html>, remembered under the site's key, light unless dark was chosen. Each
 * shell's head applies the stored choice before the first paint; this owns the button. */
function initTheme() {
  const button = $('#theme');
  let theme = 'light';
  try { theme = resolveTheme(localStorage.getItem(THEME_KEY)); } catch { /* storage may be unavailable; the toggle still works for the session */ }
  const apply = () => {
    document.documentElement.dataset.theme = theme;
    if (button) button.textContent = themeLabel(theme);
  };
  apply();
  button?.addEventListener('click', () => {
    theme = themeLabel(theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* same */ }
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

/** The pinned top block (masthead and step band) can grow when badges wrap or talk mode raises the band, so the
 * column headers pin under its measured height rather than an assumed one: `--top-h` on <html>, kept current. */
function initPinned() {
  const top = $('.top');
  if (!top || typeof ResizeObserver === 'undefined') return;
  const measure = () => document.documentElement.style.setProperty('--top-h', `${top.offsetHeight}px`);
  new ResizeObserver(measure).observe(top);
  measure();
}

export function initChrome() {
  initTheme();
  initTalkMode();
  initInstruments();
  initPinned();
}

/** The one line that stands for the instruments while they are folded. */
export function setInstrumentsSummary(text) {
  const summary = $('#instruments-summary');
  if (summary) summary.textContent = text;
}
