// The harness's self-check: the vendored conformance cases and rejections through every available assembler, judged
// as conformance/README.md says. A harness that cannot reproduce the published reports cannot be trusted with the
// demo's. An assembler whose adapter is not built is skipped, not passed. CWA_DEMO_QUICK=1 runs a three-snapshot
// smoke subset instead of the full corpus.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadAssemblers, ROOT, runAll } from '../src/harness/adapters.mjs';
import { loadConformance } from '../src/harness/cases.mjs';
import { agreement, compareResult } from '../src/harness/compare.mjs';

const QUICK = ['fixture-three-slot', 'messages-render', 'budget-variant-choice', 'schema-missing-budget', 'unpaired-surrogate'];

const assemblers = await loadAssemblers();
const available = Object.fromEntries(Object.entries(assemblers).filter(([, a]) => a.available));
const { cases, rejections } = await loadConformance(path.join(ROOT, 'vendor', 'cwa', 'conformance'));
const items = [...cases, ...rejections].filter(item => !process.env.CWA_DEMO_QUICK || QUICK.includes(item.id));

for (const [id, assembler] of Object.entries(assemblers)) {
  test(`${id} adapter is available`, { skip: assembler.available ? false : `missing ${assembler.missing.join(', ')}; run pnpm run setup` }, () => {
    assert.ok(assembler.available);
  });
}

test(`every available assembler passes each vendored case and rejects each rejection snapshot (${items.length} snapshots)`,
  { skip: Object.keys(available).length === 0 ? 'no assembler is available' : false }, async () => {
    const failures = [];
    let index = 0;
    const next = async () => {
      while (index < items.length) {
        const item = items[index++];
        const results = await runAll(available, item.snapshot);
        for (const result of results) {
          const judged = compareResult(result, item.expected);
          if (judged.outcome === 'failed') failures.push(`${item.id} (${result.assembler}): ${judged.detail}`);
        }
        const agree = agreement(results);
        if (!agree.agree) failures.push(`${item.id}: ${agree.differences.map(d => `${d.assembler} vs ${d.against}: ${d.detail}`).join('; ')}`);
      }
    };
    await Promise.all(Array.from({ length: 4 }, next));
    assert.deepEqual(failures, []);
  });

// The conformance README (Running a case) validates the snapshot first and resolves its components after, so a
// snapshot that breaks its schema is rejected even when it also names a tokenizer or renderer the assembler lacks.
// Answering "unsupported" there would let the conformance runner skip a snapshot it should judge.
test('every available assembler rejects an invalid snapshot that also names a component it lacks',
  { skip: Object.keys(available).length === 0 ? 'no assembler is available' : false }, async () => {
    const fixture = JSON.parse(cases.find(item => item.id === 'fixture-three-slot').snapshot.toString('utf8'));
    const withoutBudget = { ...fixture };
    delete withoutBudget.budget;
    const snapshots = {
      'blank tokenizer': { ...fixture, tokenizer: '﻿' },
      'missing budget, unknown tokenizer': { ...withoutBudget, tokenizer: 'my-tokenizer/v1' },
      'missing budget, unknown renderer': { ...withoutBudget, renderer: 'my-renderer/v1' },
    };
    const failures = [];
    for (const [name, snapshot] of Object.entries(snapshots)) {
      for (const result of await runAll(available, Buffer.from(JSON.stringify(snapshot)))) {
        if (result.outcome !== 'rejected') failures.push(`${name} (${result.assembler}): ${result.outcome}, ${result.detail}`);
      }
    }
    assert.deepEqual(failures, []);
  });

test('every available assembler answers unsupported for a valid snapshot that names a component it lacks',
  { skip: Object.keys(available).length === 0 ? 'no assembler is available' : false }, async () => {
    const fixture = JSON.parse(cases.find(item => item.id === 'fixture-three-slot').snapshot.toString('utf8'));
    const failures = [];
    for (const [field, id] of [['tokenizer', 'my-tokenizer/v1'], ['renderer', 'my-renderer/v1']]) {
      for (const result of await runAll(available, Buffer.from(JSON.stringify({ ...fixture, [field]: id })))) {
        if (result.outcome !== 'unsupported') failures.push(`${field} ${id} (${result.assembler}): ${result.outcome}, ${result.detail}`);
      }
    }
    assert.deepEqual(failures, []);
  });
