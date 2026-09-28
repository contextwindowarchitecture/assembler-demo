// Runs an assembler through the adapter protocol (PORTING.md): snapshot bytes on stdin, an exit code and
// {"payload": base64 | null, "trace": {...}} back. The harness and the inspector both use this and nothing else
// to reach an assembler, so what they show is exactly what the adapter returned.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The assemblers assemblers.json names, each with its command and whether its requirements are present. An
 * environment override (the entry's `env`) replaces the whole command and skips the requirement check. */
export async function loadAssemblers(root = ROOT) {
  const config = JSON.parse(await readFile(path.join(root, 'assemblers.json'), 'utf8'));
  const assemblers = {};
  for (const [id, entry] of Object.entries(config)) {
    if (id.startsWith('$')) continue;
    const override = entry.env ? process.env[entry.env] : undefined;
    const missing = override ? [] : (entry.requires ?? []).filter(file => !existsSync(path.resolve(root, file)));
    assemblers[id] = {
      id, language: entry.language, name: entry.name, checkout: entry.checkout,
      command: override ? override.trim().split(/\s+/) : entry.command,
      available: missing.length === 0, missing,
    };
  }
  return assemblers;
}

/** Run one assembler on snapshot bytes. Resolves to the classified result; it never rejects. Outcomes: `assembled`
 * (payload and trace), `refused` (null payload and trace), `rejected` (exit 2, problems in `detail`), `unsupported`
 * (exit 3, the component in `detail`) or `error` (anything else). */
export function runAdapter(assembler, bytes, { root = ROOT, timeoutMs = 60_000 } = {}) {
  return new Promise(resolve => {
    const start = performance.now();
    const [command, ...args] = assembler.command;
    const stdout = [], stderr = [];
    let child;
    try {
      child = spawn(command, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (error) {
      resolve(classify(assembler, start, { code: null, stdout: '', stderr: `cannot run ${command}: ${error.message}` }));
      return;
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => {
      clearTimeout(timer);
      resolve(classify(assembler, start, { code: null, stdout: '', stderr: `cannot run ${command}: ${error.message}` }));
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      resolve(classify(assembler, start, {
        code: signal ? null : code, signal,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
      }));
    });
    child.stdin.on('error', () => {}); // EPIPE when the adapter exits before reading everything
    child.stdin.end(bytes);
  });
}

function classify(assembler, start, { code, signal, stdout, stderr }) {
  const base = { assembler: assembler.id, durationMs: Math.round(performance.now() - start) };
  if (code === 2) return { ...base, outcome: 'rejected', detail: stderr };
  if (code === 3) return { ...base, outcome: 'unsupported', detail: stderr };
  if (code !== 0) return { ...base, outcome: 'error', detail: signal ? `killed by ${signal}` : `exit ${code}: ${stderr}` };
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return { ...base, outcome: 'error', detail: `stdout is not JSON: ${stdout.slice(0, 200)}` }; }
  if (parsed === null || typeof parsed !== 'object' || !('payload' in parsed) || !('trace' in parsed)) {
    return { ...base, outcome: 'error', detail: 'stdout is not a {payload, trace} object' };
  }
  const payload = parsed.payload === null ? null : Buffer.from(parsed.payload, 'base64');
  return { ...base, outcome: payload === null ? 'refused' : 'assembled', payload, trace: parsed.trace, stderr };
}

/** Run several assemblers on the same bytes, concurrently, in assemblers.json order. */
export function runAll(assemblers, bytes, options) {
  return Promise.all(Object.values(assemblers).map(assembler => runAdapter(assembler, bytes, options)));
}

/** The assemblers to use for a run: the ones named, or every available one. Naming an unavailable one is an error. */
export function select(assemblers, names) {
  if (!names || names.length === 0 || names.includes('all')) {
    return Object.fromEntries(Object.entries(assemblers).filter(([, a]) => a.available));
  }
  const chosen = {};
  for (const name of names) {
    const assembler = assemblers[name];
    if (!assembler) throw new Error(`no assembler ${name}; assemblers.json names ${Object.keys(assemblers).join(', ')}`);
    if (!assembler.available) throw new Error(`${name} is not available: missing ${assembler.missing.join(', ')} (run pnpm run setup)`);
    chosen[name] = assembler;
  }
  return chosen;
}
