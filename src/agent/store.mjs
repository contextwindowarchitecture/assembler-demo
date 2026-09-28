// Recorded runs: every inference's snapshot, trace, payload, outbound request and response, and every tool request
// with its authorization decision, so a run can be replayed through any assembler and shown turn by turn.
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from '../harness/adapters.mjs';

export const RUNS = path.join(ROOT, 'scenarios', 'advanced', 'runs');

export async function saveRun(run, { dir = RUNS } = {}) {
  const target = path.join(dir, run.id);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  return target;
}

export async function listRuns({ dir = RUNS } = {}) {
  if (!existsSync(dir)) return [];
  const ids = (await readdir(dir)).filter(name => existsSync(path.join(dir, name, 'run.json'))).sort();
  const runs = [];
  for (const id of ids) {
    const run = JSON.parse(await readFile(path.join(dir, id, 'run.json'), 'utf8'));
    runs.push({ id: run.id, scenario: run.scenario, title: run.title, started: run.started, provider: run.provider, model: run.model, assembler: run.assembler, turns: run.turns.length, stop: run.stop, reference: run.reference === true });
  }
  return runs;
}

export async function loadRun(id, { dir = RUNS } = {}) {
  const file = path.join(dir, id, 'run.json');
  if (!existsSync(file)) return null;
  return JSON.parse(await readFile(file, 'utf8'));
}
