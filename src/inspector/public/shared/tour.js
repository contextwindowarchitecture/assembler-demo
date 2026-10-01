// The guided tour's engine: where the tour is, where it goes next, and its copy filled from what the assemblers
// returned. Pure functions, no DOM; tour-band.js draws them. Nothing here decides anything: a number in a stop's
// copy is a placeholder the trace, the snapshot or the step's metadata fills.

const FIELDS = ['title', 'look', 'what', 'why'];

export const nextIndex = (stops, index) => Math.min(index + 1, stops.length);
export const backIndex = (stops, index) => Math.max(index - 1, 1);
/** Each stop's place in the band's progress row: done, now (the stop shown) or todo. */
export const progress = (index, total) => Array.from({ length: total }, (_, k) => (k + 1 < index ? 'done' : k + 1 === index ? 'now' : 'todo'));

/** The tour's 1-based stop from `?tour=N`, or null when the tour is not active. */
export function parseTourState(search) {
  const value = new URLSearchParams(search).get('tour');
  return value && /^[1-9]\d*$/.test(value) ? Number(value) : null;
}

/** The search string with the tour at `index`, or without it when `index` is null; other parameters stay. */
export function tourSearch(search, index) {
  const params = new URLSearchParams(search);
  if (index === null) params.delete('tour'); else params.set('tour', String(index));
  const text = params.toString();
  return text ? `?${text}` : '';
}

/** What a key does to the tour: next, back or leave while it is active; nothing (the page's own keys) otherwise. */
export function tourKey(key, active) {
  if (!active) return null;
  return { ArrowRight: 'next', ArrowLeft: 'back', Escape: 'leave' }[key] ?? null;
}

// A path is dot-separated segments (a dot inside brackets does not separate); a segment may carry [n] (an index into a
// list), [key=value] (the entries of a list whose key, itself a dotted path, has that value) or [name] (an object's
// key, for keys such as slot ids that carry dots). `.length` on a list is its count, any other name on a list reads
// that field of each entry, and a list of scalars at the end reads as "a, b".
const segments = path => path.split(/\.(?![^[]*\])/);
const read = (value, dotted) => segments(dotted).reduce((v, name) => v?.[name], value);

function resolve(path, sources) {
  let value = sources;
  for (const part of segments(path)) {
    const match = /^([^[\]]*)((?:\[[^\]]+\])*)$/.exec(part);
    if (!match) return undefined;
    const [, name, brackets] = match;
    if (name && Array.isArray(value)) value = name === 'length' ? value.length : value.map(entry => entry?.[name]);
    else if (name) value = value?.[name];
    for (const [, inner] of brackets.matchAll(/\[([^\]]+)\]/g)) {
      const filter = /^([^=]+)=(.*)$/.exec(inner);
      if (Array.isArray(value)) value = filter ? value.filter(entry => String(read(entry, filter[1])) === filter[2]) : value[Number(inner)];
      else if (!filter && value && typeof value === 'object') value = value[inner];
      else return undefined;
    }
    if (value === undefined || value === null) return undefined;
  }
  return value;
}

const show = value => (Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? undefined : String(value));

/** A stop's copy with each `{path}` filled from `sources` ({ trace, snapshot, meta, run, turn, ... }); an unresolved
 * path reads as `?` and is listed in `missing`, so the tests can insist on none. */
export function fill(template, sources) {
  const missing = [];
  const text = String(template ?? '').replace(/\{([^{}\s]+)\}/g, (_, path) => {
    const value = resolve(path, sources);
    const shown = value === undefined ? undefined : show(value);
    if (shown === undefined) { missing.push(path); return '?'; }
    return shown;
  });
  return { text, missing };
}

/** Every problem with a tour's stops, as `id: problem` lines; empty when the band can show them all. */
export function validateStops(stops) {
  const problems = [];
  const seen = new Set();
  for (const stop of stops) {
    const id = stop.id ?? '(no id)';
    for (const field of FIELDS) if (!stop[field]) problems.push(`${id}: ${field} is missing`);
    if (!stop.target) problems.push(`${id}: target is missing`);
    if (!Array.isArray(stop.proves)) problems.push(`${id}: proves is not a list`);
    if (!stop.at?.step && !stop.at?.run && !stop.at?.page) problems.push(`${id}: at names no step and no run`);
    if (stop.at?.run && !Number.isInteger(stop.at.turn)) problems.push(`${id}: at.run without at.turn`);
    if (seen.has(id)) problems.push(`${id}: duplicate id`);
    seen.add(id);
  }
  return problems;
}
