// The intermediate stage's producers: the committed snapshots are current with the sources and the producer code,
// every step's scenario.json carries the producers' report with LlamaIndex named, and a live run reproduces the
// frozen snapshot digest for digest. Skipped when the producers project is absent.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { snapshotDigest } from '@contextwindowarchitecture/assembler';
import { ROOT } from '../src/harness/adapters.mjs';
import { loadScenarios } from '../src/harness/cases.mjs';
import { produce, PRODUCERS_COMMAND, producersAvailable } from '../src/harness/producers.mjs';

const available = producersAvailable();
const skip = available ? false : 'producers/pyproject.toml is absent';
const scenarios = (await loadScenarios(path.join(ROOT, 'scenarios'))).filter(s => s.id.startsWith('intermediate/'));

test('the committed intermediate snapshots are current with the producers and their sources', { skip }, () => {
  const [command, ...args] = [...PRODUCERS_COMMAND, '--check'];
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8' });
  assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
});

test('every intermediate step records how its producers ran, with LlamaIndex as the retrieval framework', () => {
  assert.ok(scenarios.length >= 6);
  for (const scenario of scenarios) {
    const { producers } = scenario.meta;
    assert.deepEqual(Object.keys(producers), ['policy-registry', 'state-svc', 'kb-search', 'memory-svc', 'conversation'], scenario.id);
    assert.equal(producers['kb-search'].framework, 'LlamaIndex');
    assert.match(producers['kb-search'].pipeline.join(' '), /BM25Retriever/);
    assert.equal(producers['kb-search'].query, scenario.meta.retrieval.query);
  }
});

test('a live run of the producers reproduces the frozen snapshot, digest for digest', { skip, timeout: 120_000 }, async () => {
  const scenario = scenarios.find(s => s.id === 'intermediate/01-retrieval');
  const live = await produce(scenario.meta.id);
  const frozen = JSON.parse(await readFile(scenario.variants[0].files.snapshot, 'utf8'));
  assert.equal(snapshotDigest(live.snapshot), snapshotDigest(frozen));
  assert.equal(live.report['kb-search'].emitted, frozen.batches.find(b => b.producer.id === 'kb-search').items.length);
  const dropped = live.snapshot.batches.find(b => b.producer.id === 'kb-search').excluded;
  assert.deepEqual(dropped.map(row => row.reason), ['duplicate_content'], 'the retriever reports the near-duplicate it dropped');
  assert.equal(dropped[0].duplicate_of, 'kb:acme:support-plans:v7#0');
});
