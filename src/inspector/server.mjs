#!/usr/bin/env node
// The inspector: a small HTTP server that serves the four-column screen and runs the assemblers for it through the
// same harness the CLI uses. It never assembles anything itself.
// Usage: node src/inspector/server.mjs [--host 127.0.0.1] [--port 8787]; a container passes --host 0.0.0.0.
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAssemblers, ROOT, runAll, select } from '../harness/adapters.mjs';
import { loadScenarios, VARIANTS } from '../harness/cases.mjs';
import { agreement, compareResult } from '../harness/compare.mjs';
import { produce, producersAvailable } from '../harness/producers.mjs';
import { runAgent } from '../agent/controller.mjs';
import { listRuns, loadRun, saveRun } from '../agent/store.mjs';
import { loadSource } from '../agent/capabilities.mjs';
import { loadRoutes } from '../agent/producers.mjs';
import { loadDotEnv } from '../env.mjs';
import { answer, describeProviders } from '../provider/index.mjs';
import { snippets } from '../provider/snippets.mjs';

const PUBLIC = path.join(ROOT, 'src', 'inspector', 'public');
const SCENARIOS = path.join(ROOT, 'scenarios');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

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

/** POST /api/produce: {scenario, variant, assemblers?}. Runs the stage's producers now, assembles what they built,
 * and says whether the live snapshot's digest equals the frozen one's: live production and replay agree. */
async function produceAndAssemble(body, assemblers) {
  const scenario = await findScenario(body.scenario);
  const variant = scenario.variants.find(v => v.name === (body.variant ?? 'fixture'));
  if (!variant) throw new HttpError(404, `scenario ${scenario.id} has no ${body.variant} rendering`);
  if (!producersAvailable()) throw new HttpError(409, 'the producers project is not present (producers/pyproject.toml)');
  let live;
  try { live = await produce(scenario.meta.id); } catch (error) { throw new HttpError(502, error.message); }
  const snapshot = variant.name === 'messages' ? live.snapshot_messages : live.snapshot;
  const bytes = Buffer.from(JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  let chosen;
  try { chosen = select(assemblers, body.assemblers); } catch (error) { throw new HttpError(400, error.message); }
  const results = await runAll(chosen, bytes);
  const liveDigest = results.find(r => r.trace)?.trace.context.snapshot_digest ?? null;
  const frozenDigest = variant.expected?.trace.context.snapshot_digest ?? null;
  return {
    scenario: scenario.id, variant: variant.name, live: true, derived: false, snapshot,
    report: live.report,
    results: results.map(publicResult),
    agreement: agreement(results),
    expectation: variant.expected
      ? { ...scenario.meta.expectations, results: results.map(r => ({ assembler: r.assembler, ...compareResult(r, variant.expected) })) }
      : null,
    replay: { frozen_digest: frozenDigest, live_digest: liveDigest, matches: frozenDigest !== null && frozenDigest === liveDigest },
  };
}

/** POST /api/agent/replay: {run, assemblers?}. Every recorded inference through the assemblers, judged against the
 * trace recorded at the time, with four-way agreement. */
async function replayRun(body, assemblers) {
  const run = await loadRun(String(body.run ?? ''));
  if (!run) throw new HttpError(404, `no recorded run ${body.run}`);
  let chosen;
  try { chosen = select(assemblers, body.assemblers); } catch (error) { throw new HttpError(400, error.message); }
  const turns = [];
  for (const turn of run.turns) {
    const results = await runAll(chosen, Buffer.from(JSON.stringify(turn.snapshot, null, 2) + '\n', 'utf8'));
    const expected = turn.trace ? { payload: turn.payload === null ? null : Buffer.from(turn.payload, 'utf8'), trace: turn.trace } : null;
    turns.push({ n: turn.n, results: results.map(r => ({ assembler: r.assembler, outcome: r.outcome, durationMs: r.durationMs, ...(expected ? compareResult(r, expected) : { judged: 'no recorded trace' }) })), agreement: agreement(results) });
  }
  return { run: run.id, turns };
}

async function handle(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const assemblers = await loadAssemblers();
  if (req.method === 'GET' && url.pathname === '/api/state') {
    const scenarios = await loadScenarios(SCENARIOS);
    return json(res, 200, {
      assemblers: Object.values(assemblers).map(({ id, language, name, available, missing }) => ({ id, language, name, available, missing })),
      providers: await describeProviders(),
      producers: { available: producersAvailable() },
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
  if (req.method === 'POST' && url.pathname === '/api/produce') return json(res, 200, await produceAndAssemble(await readJsonBody(req), assemblers));
  if (req.method === 'GET' && url.pathname === '/api/agent/scenarios') return json(res, 200, loadSource('scenarios.json').map(s => ({ ...s, faults: s.faults })));
  if (req.method === 'GET' && url.pathname === '/api/agent/routes') {
    return json(res, 200, Object.values(loadRoutes()).map(r => ({ id: r.id, title: r.title, provider: r.provider, budget: r.budget ?? loadSource('common.json').budget, summary: r.summary, differences: r.differences, policy_version: r.route_policy.version, profile: r.profile.messages.id, placement: r.profile.messages.placement, slots: r.route_policy.slots })));
  }
  if (req.method === 'GET' && url.pathname === '/api/agent/runs') return json(res, 200, await listRuns());
  const runFile = url.pathname.match(/^\/api\/agent\/runs\/([^/]+)$/);
  if (req.method === 'GET' && runFile) {
    const run = await loadRun(decodeURIComponent(runFile[1]));
    if (!run) throw new HttpError(404, 'no such run');
    return json(res, 200, run);
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/run') {
    const body = await readJsonBody(req);
    if (typeof body.scenario !== 'string') throw new HttpError(400, 'name the scenario');
    let run;
    try { run = await runAgent({ scenarioId: body.scenario, routeId: body.route ?? undefined, providerId: body.provider || undefined, assemblerId: body.assembler ?? 'python', faults: body.faults }); }
    catch (error) { throw new HttpError(502, error.message); }
    await saveRun(run);
    return json(res, 200, run);
  }
  if (req.method === 'POST' && url.pathname === '/api/agent/replay') return json(res, 200, await replayRun(await readJsonBody(req), assemblers));
  if (req.method === 'POST' && url.pathname === '/api/answer') {
    const body = await readJsonBody(req);
    if (typeof body.payload !== 'string') throw new HttpError(400, 'a live answer needs the payload of a successful cwa-messages/v1 assembly');
    if (typeof body.provider !== 'string') throw new HttpError(400, 'name the provider: local, anthropic or openai');
    return json(res, 200, await answer(body.payload, { provider: body.provider, maxTokens: Number.isInteger(body.reserved_output) ? body.reserved_output : undefined }));
  }
  if (req.method === 'POST' && url.pathname === '/api/snippets') {
    const body = await readJsonBody(req);
    if (typeof body.payload !== 'string') throw new HttpError(400, 'snippets need the payload of a successful cwa-messages/v1 assembly');
    const providers = Object.fromEntries((await describeProviders()).map(p => [p.id, p]));
    const anthropicCustom = providers.anthropic.base_url !== 'https://api.anthropic.com';
    try {
      return json(res, 200, snippets(body.payload, {
        maxTokens: Number.isInteger(body.reserved_output) ? body.reserved_output : undefined,
        anthropic: { model: providers.anthropic.model, base_url: anthropicCustom ? providers.anthropic.base_url : null, thinking: providers.anthropic.thinking },
        openai: { model: providers.openai.model, base_url: providers.openai.base_url === 'https://api.openai.com/v1' ? null : providers.openai.base_url, maxTokensField: 'max_completion_tokens', reasoning_effort: providers.openai.reasoning_effort },
        local: providers.local.configured ? { model: providers.local.model, base_url: providers.local.base_url, maxTokensField: 'max_tokens', reasoning_effort: providers.local.reasoning_effort } : undefined,
      }));
    } catch (error) { throw new HttpError(400, error.message); }
  }
  if (req.method === 'GET') {
    const file = path.normalize(url.pathname.endsWith('/') ? `${url.pathname}index.html` : url.pathname);
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

/** Where to listen: loopback on 8787 unless --host, --port or PORT (which wins over --port) say otherwise. Loopback
 * is the default because the inspector has no login; a container passes --host 0.0.0.0 and exposes the port itself. */
export function listenAddress(argv = process.argv, env = process.env) {
  const flag = name => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : undefined);
  return { host: flag('--host') ?? '127.0.0.1', port: Number(env.PORT ?? flag('--port') ?? 8787) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const loaded = loadDotEnv();
  const { host, port } = listenAddress();
  createInspector().listen(port, host, () => console.log(`CWA demo inspector: http://${host === '0.0.0.0' ? 'localhost' : host}:${port}${loaded ? ' (providers from .env)' : ' (no .env: copy .env.example to configure a provider)'}`));
}
