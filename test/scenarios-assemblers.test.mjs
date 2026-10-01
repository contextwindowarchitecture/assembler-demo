// What pnpm run compare checks, as a test: every frozen scenario, in both renderings, through every available
// assembler, judged against its committed expectation and across the assemblers. scenarios.test.mjs checks that each
// expectation is consistent with its snapshot; this checks that the assemblers still produce it, so a contract or
// assembler change that moves a payload or a trace fails here rather than only in compare. An assembler whose adapter
// is not built is skipped, as in conformance.test.mjs; a result skipped for an unsupported component is a failure,
// since every scenario uses published components.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadAssemblers, ROOT, runAll } from '../src/harness/adapters.mjs';
import { loadScenarios } from '../src/harness/cases.mjs';
import { agreement, compareResult } from '../src/harness/compare.mjs';

const assemblers = await loadAssemblers();
const available = Object.fromEntries(Object.entries(assemblers).filter(([, a]) => a.available));
const scenarios = await loadScenarios(path.join(ROOT, 'scenarios'));
const variants = scenarios.flatMap(scenario => scenario.variants.map(variant => ({ id: `${scenario.id} ${variant.name}`, variant })));

test(`every available assembler reproduces each scenario's expectation (${variants.length} snapshots)`,
  { skip: Object.keys(available).length === 0 ? 'no assembler is available' : false }, async () => {
    const failures = [];
    let index = 0;
    const next = async () => {
      while (index < variants.length) {
        const { id, variant } = variants[index++];
        if (!variant.expected) { failures.push(`${id}: no expectation`); continue; }
        const results = await runAll(available, variant.snapshot);
        for (const result of results) {
          const judged = compareResult(result, variant.expected);
          if (judged.outcome !== 'passed') failures.push(`${id} (${result.assembler}): ${judged.outcome}${judged.detail ? `: ${judged.detail}` : ''}`);
        }
        const agree = agreement(results);
        if (!agree.agree) failures.push(`${id}: ${agree.differences.map(d => `${d.assembler} vs ${d.against}: ${d.detail}`).join('; ')}`);
      }
    };
    await Promise.all(Array.from({ length: 4 }, next));
    assert.deepEqual(failures, []);
  });
