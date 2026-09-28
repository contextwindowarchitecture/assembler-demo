// Runs the intermediate stage's producers live, through the same command that froze the committed snapshots:
// `producers.freeze --step <id> --print`. What comes back is the snapshot the producers built now, and a report of
// how each ran. The inspector's live mode assembles it and checks its digest against the frozen one.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './adapters.mjs';

export const PRODUCERS_COMMAND = ['uv', 'run', '--quiet', '--directory', 'producers', 'python', '-m', 'producers.freeze'];

/** Whether the producers project is present. `uv` fetches its environment on first run. */
export function producersAvailable(root = ROOT) {
  return existsSync(path.join(root, 'producers', 'pyproject.toml'));
}

/** Run every producer for one step and resolve to {snapshot, snapshot_messages, report}. Rejects with the
 * producers' stderr when they fail. */
export function produce(stepId, { root = ROOT, timeoutMs = 120_000 } = {}) {
  return new Promise((resolve, reject) => {
    const [command, ...args] = [...PRODUCERS_COMMAND, '--step', stepId, '--print'];
    const stdout = [], stderr = [];
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => { clearTimeout(timer); reject(new Error(`cannot run the producers (${command}): ${error.message}`)); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      const err = Buffer.concat(stderr).toString('utf8').trim();
      if (signal) return reject(new Error(`the producers were killed by ${signal}`));
      if (code !== 0) return reject(new Error(`the producers exited ${code}: ${err}`));
      try { resolve(JSON.parse(Buffer.concat(stdout).toString('utf8'))); }
      catch { reject(new Error(`the producers did not print JSON: ${Buffer.concat(stdout).toString('utf8').slice(0, 200)}`)); }
    });
  });
}
