// Ajv validators for the vendored schemas (draft 2020-12), compiled once. The harness validates scenario snapshots
// and expected traces with them; the adapters do their own validation, and this never stands in for it.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Ajv2020 } from 'ajv/dist/2020.js';
import formats from 'ajv-formats';
import { ROOT } from './adapters.mjs';

const BASE = 'https://contextwindowarchitecture.io/schema/';
const SCHEMA_DIR = path.join(ROOT, 'vendor', 'cwa', 'schema');
// strictTypes is off because the published schemas use `properties` inside `if` without restating `type`.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false, strictRequired: false });
formats.default(ajv);
for (const name of readdirSync(SCHEMA_DIR).filter(n => n.endsWith('.schema.json'))) {
  ajv.addSchema(JSON.parse(readFileSync(path.join(SCHEMA_DIR, name), 'utf8')));
}

function validator(file) {
  const validate = ajv.getSchema(BASE + file);
  if (!validate) throw new Error(`schema ${file} is not vendored`);
  return validate;
}

export const validateSnapshot = validator('snapshot.schema.json');
export const validateTrace = validator('trace.schema.json');

/** Ajv's errors in words: the JSON pointer of the value, then what is wrong with it. */
export function problems(validate) {
  return (validate.errors ?? []).filter(e => e.keyword !== 'if')
    .map(e => `${e.instancePath || '/'} ${e.message ?? 'is invalid'}${e.keyword === 'additionalProperties' ? `: ${e.params.additionalProperty}` : ''}`);
}
