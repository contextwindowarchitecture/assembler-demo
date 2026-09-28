// The tool guard: every tool request the model makes is checked here before anything is called, against the grant
// (is the tool offered on this route), the tool's own input schema, and the scope rule the capability policy
// attaches to it. A denial never reaches a server. The model's wording plays no part (R-7): only the request's
// name and arguments, and the application's own state, are consulted.
import { Ajv2020 } from 'ajv/dist/2020.js';

const ajv = new Ajv2020({ allErrors: true, strict: false });
const validators = new Map();

function validator(schema) {
  // The MCP SDK stamps a draft-07 $schema on the schemas it derives; the rules are the same, the marker is not ours.
  const { $schema, ...rules } = schema ?? {};
  const key = JSON.stringify(rules);
  if (!validators.has(key)) validators.set(key, ajv.compile(rules));
  return validators.get(key);
}

function resolveScope(ref, { scope, account }) {
  if (ref === 'request.user') return scope.user;
  if (ref === 'request.tenant') return scope.tenant;
  if (ref === 'account.region') return account?.region;
  return undefined;
}

/**
 * Authorize one tool request. `granted` is the capability policy's grants as grantTools returns them; `proposed`
 * lists what the servers offer, so a denial can say whether the tool exists at all. Returns
 * {decision: 'approved' | 'denied', reason, cap?}.
 */
export function authorize(call, { granted, proposed = [], scope, account }) {
  const args = call.arguments && typeof call.arguments === 'object' ? call.arguments : {};
  const entry = Object.entries(granted).find(([, grant]) => grant.tool === call.name);
  if (!entry) {
    const exists = proposed.some(t => t.name === call.name);
    return { decision: 'denied', reason: exists ? `${call.name} is not granted on this route (a server proposes it; the capability policy does not offer it)` : `${call.name} is not a tool this route knows` };
  }
  const [capId, grant] = entry;
  const validate = validator(grant.schema ?? { type: 'object' });
  if (!validate(args)) {
    const problems = (validate.errors ?? []).map(e => `${e.instancePath || '/'} ${e.message}`).join('; ');
    return { decision: 'denied', reason: `arguments do not match the tool's schema: ${problems}`, cap: capId };
  }
  for (const [argument, ref] of Object.entries(grant.scope ?? {})) {
    const expected = resolveScope(ref, { scope, account });
    if (args[argument] !== expected) {
      return { decision: 'denied', reason: `${argument}=${JSON.stringify(args[argument])} is outside the request's scope (${ref} is ${JSON.stringify(expected)})`, cap: capId };
    }
  }
  return { decision: 'approved', reason: `granted as ${capId}; arguments valid; scope satisfied`, cap: capId };
}
