#!/usr/bin/env node
// The inspector: a small HTTP server that serves the four-column screen and runs the assemblers for it through the
// same harness the CLI uses. It never assembles anything itself. Usage: node src/inspector/server.mjs [--port 8787]
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssemblers, ROOT, runAll, select } from '../harness/adapters.mjs';
import { loadScenarios, VARIANTS } from '../harness/cases.mjs';
import { agreement, compareResult } from '../harness/compare.mjs';
import { answer, describeProviders } from '../provider/index.mjs';

const PORT = Number(process.env.PORT ?? (process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : 8787));
const PUBLIC = path.join(ROOT, 'src', 'inspector', 'public');
const SCENARIOS = path.join(ROOT, 'scenarios');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const send = (res, status, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};
const json = (res, status, value) => send(res, status, JSON.stringify(value));

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, 'the request body is not JSON'); }
}

async function contract() {
  const read = async name => JSON.parse(await readFile(path.join(ROOT, 'vendor', 'cwa', 'contract', name), 'utf8'));
  const [reasons, slotDefaults, requirements] = await Promise.all([read('reasons.json'), read('slot-defaults.json'), read('requirements.json')]);
  return { reasons: Object.fromEntries(reasons.map(r => [r.code, r])), slot_defaults: slotDefaults, requirements };
}

async function findScenario(id) {
  const scenario = (await loadScenarios(SCENARIOS)).find(s => s.id === id);
  if (!scenario) throw new HttpError(404, `no scenario ${id}`);
  return scenario;
}

const publicResult = result => ({ ...result, payload: result.payload === undefined ? undefined : result.payload === null ? null : result.payload.toString('utf8') });

/** POST /api/assemble: {scenario, variant, assemblers?, budget?}. A budget override derives a new snapshot from the
 * frozen one, so the response says so and skips the expectation. */
async function assemble(body, assemblers) {
  const scenario = await findScenario(body.scenario);
  const variant = scenario.variants.find(v => v.name === (body.variant ?? 'fixture'));
  if (!variant) throw new HttpError(404, `scenario ${scenario.id} has no ${body.variant} rendering`);
  let bytes = variant.snapshot, derived = false;
  const snapshot = JSON.parse(variant.snapshot.toString('utf8'));
  if (body.budget && Number.isInteger(body.budget.input) && body.budget.input !== snapshot.budget.input) {
    snapshot.budget = { ...snapshot.budget, input: body.budget.input };
    bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    derived = true;
  }
  let chosen;
  try { chosen = select(assemblers, body.assemblers); } catch (error) { throw new HttpError(400, error.message); }
  const results = await runAll(chosen, bytes);
  return {
    scenario: scenario.id, variant: variant.name, derived, snapshot,
    results: results.map(publicResult),
    agreement: agreement(results),
    expectation: !derived && variant.expected
      ? { ...scenario.meta.expectations, results: results.map(r => ({ assembler: r.assembler, ...compareResult(r, variant.expected) })) }
      : null,
  };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const assemblers = await loadAssemblers();
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const scenarios = await loadScenarios(SCENARIOS);
    return json(res, 200, {
      assemblers: Object.values(assemblers).map(({ id, language, name, available, missing }) => ({ id, language, name, available, missing })),
      providers: await describeProviders(),
      scenarios: scenarios.map(s => ({ id: s.id, meta: s.meta, variants: s.variants.map(v => v.name) })),
    });
  }
  if (req.method === 'GET' && url.pathname === '/api/providers') return json(res, 200, await describeProviders());
  if (req.method === 'GET' && url.pathname === '/api/contract') return json(res, 200, await contract());
  const snapshotFile = url.pathname.match(/^\/api\/scenarios\/(.+)\/(fixture|messages)\/snapshot\.json$/);
  if (req.method === 'GET' && snapshotFile) {
    const scenario = await findScenario(decodeURIComponent(snapshotFile[1]));
    const variant = scenario.variants.find(v => v.name === snapshotFile[2]);
    if (!variant) throw new HttpError(404, 'no such rendering');
    return send(res, 200, variant.snapshot, MIME['.json']);
  }
  if (req.method === 'POST' && url.pathname === '/api/assemble') return json(res, 200, await assemble(await readJsonBody(req), assemblers));
  if (req.method === 'POST' && url.pathname === '/api/answer') {
    const body = await readJsonBody(req);
    if (typeof body.payload !== 'string') throw new HttpError(400, 'a live answer needs the payload of a successful cwa-messages/v1 assembly');
    if (typeof body.provider !== 'string') throw new HttpError(400, 'name the provider: local, anthropic or openai');
    return json(res, 200, await answer(body.payload, { provider: body.provider, maxTokens: Number.isInteger(body.reserved_output) ? body.reserved_output : undefined }));
  }
  if (req.method === 'GET') {
    const file = path.normalize(url.pathname === '/' ? '/index.html' : url.pathname);
    const target = path.join(PUBLIC, file);
    if (!target.startsWith(PUBLIC)) throw new HttpError(404, 'not found');
    try { return send(res, 200, await readFile(target), MIME[path.extname(target)] ?? 'application/octet-stream'); }
    catch { throw new HttpError(404, `no ${file}`); }
  }
  throw new HttpError(404, 'not found');
}

/** The inspector as an http.Server, not yet listening, so a test can bind it to any port. */
export function createInspector() {
  return http.createServer((req, res) => {
    handle(req, res).catch(error => json(res, error.status ?? 500, { error: error.message }));
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  createInspector().listen(PORT, '127.0.0.1', () => console.log(`CWA demo inspector: http://localhost:${PORT}`));
}
