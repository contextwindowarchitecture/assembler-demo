// Provider settings for a demo machine live in .env (gitignored; see .env.example). What the file says is what runs:
// its values replace ambient ones, so a stray ANTHROPIC_BASE_URL in a shell cannot redirect the demo.
import { existsSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './harness/adapters.mjs';

/** Load ROOT/.env into process.env when it exists. Returns whether it did. */
export function loadDotEnv(root = ROOT) {
  const file = path.join(root, '.env');
  if (!existsSync(file)) return false;
  process.loadEnvFile(file);
  return true;
}
