// What changed since the step (or turn) you came from: two snapshots and two traces in, a strip of cells and a
// chip per candidate out. A pure comparison of what the assemblers decided; nothing here decides anything.
import { $, esc, reasonChip, tag } from './format.js';

const count = (snapshot, slot) => snapshot.batches.reduce((n, b) => n + b.items.filter(i => i.slot === slot).length, 0);

/** The counts one step reduces to. Without a trace (a rejected snapshot), the trace-derived counts are null. */
export function stepFacts(snapshot, trace) {
  if (!snapshot) return null;
  return {
    budget: snapshot.budget.input,
    candidates: snapshot.batches.reduce((n, b) => n + b.items.length, 0),
    observations: count(snapshot, 'evidence.tool_results'),
    history: count(snapshot, 'interaction.history'),
    conflicts: snapshot.conflicts.length,
    included: trace ? trace.included.length : null,
    compressed: trace ? trace.compressed.length : null,
    excluded: trace ? trace.excluded.length : null,
    tokens: trace?.result ? trace.result.input_tokens : null,
    refused: Boolean(trace?.refused.bool),
    codes: trace ? [...new Set([...trace.excluded.map(r => r.reason), ...(trace.refused.reason ? [trace.refused.reason] : [])])] : [],
  };
}

const CELLS = {
  step: [['budget', 'budget.input'], ['candidates', 'candidates'], ['conflicts', 'declared conflicts'], ['included', 'included'], ['compressed', 'compressed'], ['excluded', 'excluded'], ['tokens', 'input tokens']],
  turn: [['candidates', 'candidates'], ['observations', 'observations'], ['history', 'history turns'], ['included', 'included'], ['excluded', 'excluded'], ['tokens', 'input tokens']],
};

/** The strip's cells: each count before and after, whether it changed, and on the excluded cell the codes new to this step. */
export function deltaCells(before, after, noun = 'step') {
  const show = value => (value === null ? 'null' : value);
  return (CELLS[noun] ?? CELLS.step)
    .filter(([key]) => key !== 'conflicts' || before.conflicts || after.conflicts)
    .map(([key, label]) => {
      const cell = { label, before: show(before[key]), after: show(after[key]), same: before[key] === after[key] };
      if (key === 'excluded') {
        const codes = after.codes.filter(code => !before.codes.includes(code));
        if (codes.length) cell.codes = codes;
      }
      return cell;
    });
}

/** What a candidate was in the step you came from, when that differs from what it is now. `previous` is null when the previous snapshot did not carry the item. */
export function statusChange(previous, current, noun = 'step') {
  if (previous === null) return `new this ${noun}`;
  if (!previous || previous.kind === 'none' || !current || current.kind === 'none') return null;
  const was = status => (status.kind === 'excluded' ? status.reason : status.kind);
  return was(previous) === was(current) ? null : `was ${was(previous)}`;
}

/** Draw the strip under the step header; nothing when there is no step to compare with. */
export function renderDelta(page, result) {
  const strip = $('#delta');
  if (!strip) return;
  const previous = page.previous?.() ?? null;
  const now = stepFacts(page.state.response?.snapshot ?? null, result?.trace ?? null);
  const then = previous ? stepFacts(previous.snapshot, previous.trace) : null;
  if (!now || !then) { strip.innerHTML = ''; return; }
  const noun = page.noun ?? 'step';
  strip.innerHTML = `<div class="since"><span class="kicker">Since ${esc(previous.label)}</span><span class="meta">${noun === 'turn' ? 'the previous inference' : 'the step you came from'}</span></div>`
    + deltaCells(then, now, noun).map(cell => `<div class="cell${cell.same ? ' same' : ''}"><span class="meta">${esc(cell.label)}</span>
      <span class="v">${cell.same ? `${esc(cell.after)}<span class="arr">· same</span>` : `${esc(cell.before)}<span class="arr">→</span>${esc(cell.after)}`}${(cell.codes ?? []).map(code => reasonChip(code, 'bad code xs', page.reasonText(code))).join('')}</span></div>`).join('');
}
