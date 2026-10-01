// The guided tours: the engine's pure functions, and every tour's stops checked against what the assemblers
// returned, so a tour cannot claim what the trace does not hold.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backIndex, fill, nextIndex, parseTourState, tourKey, tourSearch, validateStops } from '../src/inspector/public/shared/tour.js';

const stop = (id, extra = {}) => ({ id, at: { step: '01-clean' }, target: 'columns', title: 'A title', look: 'Look here.', what: 'What happened.', why: 'Why it matters.', proves: [], ...extra });

test('the tour index moves within its stops and never past either end', () => {
  const stops = [stop('a'), stop('b'), stop('c')];
  assert.equal(nextIndex(stops, 1), 2);
  assert.equal(nextIndex(stops, 3), 3);
  assert.equal(backIndex(stops, 2), 1);
  assert.equal(backIndex(stops, 1), 1);
});

test('the tour state lives in ?tour=N beside whatever else the URL carries', () => {
  assert.equal(parseTourState('?tour=3'), 3);
  assert.equal(parseTourState('?x=1&tour=12'), 12);
  for (const inactive of ['', '?', '?tour=', '?tour=0', '?tour=-2', '?tour=two', '?tour=1.5', '?other=1']) assert.equal(parseTourState(inactive), null, inactive);
  assert.equal(tourSearch('', 4), '?tour=4');
  assert.equal(tourSearch('?x=1', 2), '?x=1&tour=2');
  assert.equal(tourSearch('?x=1&tour=2', null), '?x=1');
  assert.equal(tourSearch('?tour=2', null), '');
});

test('the keyboard drives the tour while it is active and the page while it is not', () => {
  assert.equal(tourKey('ArrowRight', true), 'next');
  assert.equal(tourKey('ArrowLeft', true), 'back');
  assert.equal(tourKey('Escape', true), 'leave');
  assert.equal(tourKey('Enter', true), null);
  for (const key of ['ArrowRight', 'ArrowLeft', 'Escape']) assert.equal(tourKey(key, false), null);
});

test('fill takes every number and id from the sources and reports what it could not resolve', () => {
  const sources = {
    trace: { excluded: [{ item_id: 'a', reason: 'expired' }, { item_id: 'b', reason: 'over_budget' }, { item_id: 'c', reason: 'over_budget' }], result: { input_tokens: 155 } },
    meta: { budget: { input: 170 } },
  };
  assert.deepEqual(fill('budget.input {meta.budget.input}, {trace.result.input_tokens} tokens', sources), { text: 'budget.input 170, 155 tokens', missing: [] });
  assert.deepEqual(fill('{trace.excluded.length} excluded', sources), { text: '3 excluded', missing: [] });
  assert.deepEqual(fill('{trace.excluded[reason=over_budget].length} over budget, first {trace.excluded[0].item_id}', sources), { text: '2 over budget, first a', missing: [] });
  assert.deepEqual(fill('{trace.excluded[reason=over_budget].item_id}', sources), { text: 'b, c', missing: [] });
  assert.deepEqual(fill('{trace.nothing.here} and {snapshot.budget}', sources), { text: '? and ?', missing: ['trace.nothing.here', 'snapshot.budget'] });
  assert.deepEqual(fill('no placeholders', sources), { text: 'no placeholders', missing: [] });
});

test('validateStops names every stop that lacks a field the band shows', () => {
  assert.deepEqual(validateStops([stop('a')]), []);
  assert.deepEqual(validateStops([stop('a', { why: '' }), stop('a')]), ['a: why is missing', 'a: duplicate id']);
  assert.deepEqual(validateStops([stop('b', { at: {} })]), ['b: at names no step and no run']);
  assert.deepEqual(validateStops([stop('c', { proves: 'expired' })]), ['c: proves is not a list']);
  assert.deepEqual(validateStops([stop('d', { at: { run: 'reference-01-investigate' } })]), ['d: at.run without at.turn']);
});
