// Loads the two kinds of input the harness runs: the vendored conformance cases and rejections, and the demo
// scenarios. Both are read as bytes, so the adapters see the snapshot text exactly as written.
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

/** UTF-16 code unit order, the order conformance/README.md uses for ids (Ordering); JavaScript's `<` compares so. */
export const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

async function directories(dir) {
  if (!existsSync(dir)) return [];
  const names = await readdir(dir);
  const found = [];
  for (const name of names) if ((await stat(path.join(dir, name))).isDirectory()) found.push(path.join(dir, name));
  return found;
}

const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

/** Every case and rejection under a conformance directory, each with its snapshot bytes and expectation. */
export async function loadConformance(dir) {
  const cases = [], rejections = [];
  for (const caseDir of await directories(path.join(dir, 'cases'))) {
    const meta = await readJson(path.join(caseDir, 'case.json'));
    const payloadFile = path.join(caseDir, 'expected.payload.txt');
    cases.push({
      id: meta.id, rules: meta.rules, description: meta.description, dir: caseDir,
      snapshot: await readFile(path.join(caseDir, 'snapshot.json')),
      expected: {
        payload: existsSync(payloadFile) ? await readFile(payloadFile) : null,
        trace: await readJson(path.join(caseDir, 'expected.trace.json')),
      },
    });
  }
  for (const caseDir of await directories(path.join(dir, 'rejections'))) {
    const meta = await readJson(path.join(caseDir, 'case.json'));
    rejections.push({
      id: meta.id, rules: meta.rules, description: meta.description, dir: caseDir,
      snapshot: await readFile(path.join(caseDir, 'snapshot.json')), expected: { rejection: true },
    });
  }
  return { cases: cases.sort(byId), rejections: rejections.sort(byId) };
}

/** A scenario's two frozen inputs: the fixture rendering, for byte-exact comparison, and the messages rendering, for
 * the model. Each has its own expectation files beside it. */
export const VARIANTS = [
  { name: 'fixture', snapshot: 'snapshot.json', payload: 'expected.payload.txt', trace: 'expected.trace.json' },
  { name: 'messages', snapshot: 'snapshot.messages.json', payload: 'expected.messages.payload.txt', trace: 'expected.messages.trace.json' },
];

/** Every scenario under a directory tree: a directory holding scenario.json, at any depth, with the variants whose
 * snapshot file exists. `expected` is null for a variant with no expected trace yet. */
export async function loadScenarios(dir, root = dir) {
  const scenarios = [];
  for (const child of await directories(dir)) {
    if (existsSync(path.join(child, 'scenario.json'))) {
      const meta = await readJson(path.join(child, 'scenario.json'));
      const variants = [];
      for (const variant of VARIANTS) {
        const snapshotFile = path.join(child, variant.snapshot);
        if (!existsSync(snapshotFile)) continue;
        const traceFile = path.join(child, variant.trace), payloadFile = path.join(child, variant.payload);
        variants.push({
          name: variant.name, files: { snapshot: snapshotFile, payload: payloadFile, trace: traceFile },
          snapshot: await readFile(snapshotFile),
          expected: existsSync(traceFile)
            ? { payload: existsSync(payloadFile) ? await readFile(payloadFile) : null, trace: await readJson(traceFile) }
            : null,
        });
      }
      scenarios.push({ id: path.relative(root, child).split(path.sep).join('/'), dir: child, meta, variants });
    } else {
      scenarios.push(...await loadScenarios(child, root));
    }
  }
  return scenarios.sort(byId);
}
