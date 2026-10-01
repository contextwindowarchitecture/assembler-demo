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
