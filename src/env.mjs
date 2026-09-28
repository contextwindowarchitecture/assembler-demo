// Provider settings for a demo machine live in .env (gitignored; see .env.example). What the file says is what runs:
// its values replace ambient ones, so a stray ANTHROPIC_BASE_URL in a shell cannot redirect the demo.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { ROOT } from './harness/adapters.mjs';

/** Load ROOT/.env into process.env when it exists, replacing ambient values (process.loadEnvFile would keep them,
 * and a stray ANTHROPIC_BASE_URL in a shell must not redirect the demo). Returns whether the file existed. */
export function loadDotEnv(root = ROOT) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return false;
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) process.env[key] = value;
  return true;
}
