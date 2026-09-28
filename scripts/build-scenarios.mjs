#!/usr/bin/env node
// Generates each basic-stage step's frozen snapshots from scenarios/basic/source/: the shared fields, the route
// policy, the two profiles, the clean fixture's batches and each step's cumulative additions. The generated files
// are committed, so the same bytes reach every assembler; `--check` fails when they are stale.
//
//   node scripts/build-scenarios.mjs            # write scenarios/basic/<step>/snapshot*.json and scenario.json
//   node scripts/build-scenarios.mjs --check    # exit 1 when a generated file differs from its source
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const STAGE = path.join(ROOT, 'scenarios', 'basic');
const SOURCE = path.join(STAGE, 'source');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const clone = value => JSON.parse(JSON.stringify(value));
const text = value => JSON.stringify(value, null, 2) + '\n';

/** The snapshots and metadata for every step, keyed by step id. */
export async function buildScenarios() {
  const [common, routePolicy, profiles, base, steps] = await Promise.all(
    ['common.json', 'route-policy.json', 'profiles.json', 'items.json', 'steps.json'].map(name => readJson(path.join(SOURCE, name))));
  const batches = Object.entries(base).filter(([id]) => !id.startsWith('$'))
    .map(([id, batch]) => ({ producer: { id, kind: batch.kind }, items: clone(batch.items), excluded: clone(batch.excluded) }));
  const built = {};
  for (const step of steps) {
    for (const [producer, items] of Object.entries(step.add)) {
      const batch = batches.find(b => b.producer.id === producer);
      if (!batch) throw new Error(`${step.id} adds items for ${producer}, which items.json does not list`);
      batch.items.push(...clone(items));
    }
    const snapshot = variant => ({
      assembly_time: common.assembly_time,
      scope: common.scope,
      budget: step.budget,
      profile: profiles[variant],
      route_policy: routePolicy,
      tokenizer: common.tokenizer,
      renderer: common.renderers[variant],
      batches: clone(batches),
      conflicts: common.conflicts,
    });
    const { add, ...meta } = step;
    built[step.id] = {
      meta: { ...meta, added: Object.fromEntries(Object.entries(add).map(([producer, items]) => [producer, items.map(item => item.id)])) },
      files: { 'snapshot.json': text(snapshot('fixture')), 'snapshot.messages.json': text(snapshot('messages')) },
    };
  }
  return built;
}

async function main(check) {
  const built = await buildScenarios();
  const stale = [];
  for (const [id, { meta, files }] of Object.entries(built)) {
    const dir = path.join(STAGE, id);
    const metaFile = path.join(dir, 'scenario.json');
    // scenario.json is generated from the step, except expectations, which `cwa-demo expect` maintains.
    const existing = existsSync(metaFile) ? await readJson(metaFile) : {};
    const scenario = text({ ...meta, expectations: existing.expectations ?? { generated_by: null, reviewed: false } });
    const wanted = { ...files, 'scenario.json': scenario };
    for (const [name, content] of Object.entries(wanted)) {
      const file = path.join(dir, name);
      const current = existsSync(file) ? await readFile(file, 'utf8') : null;
      if (current === content) continue;
      if (check) { stale.push(path.relative(ROOT, file)); continue; }
      await mkdir(dir, { recursive: true });
      await writeFile(file, content);
      console.log(`wrote ${path.relative(ROOT, file)}`);
    }
  }
  if (check && stale.length) {
    console.error(`stale (run npm run scenarios:build):\n  ${stale.join('\n  ')}`);
    return 1;
  }
  if (check) console.log(`${Object.keys(built).length} scenarios are current`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.includes('--check')).then(code => { process.exitCode = code; }, error => { console.error(error.message); process.exitCode = 2; });
}
