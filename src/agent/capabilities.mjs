// The capability policy: the application's versioned allow-list of tools the model may be offered on this route.
// MCP servers propose tools; only this policy grants them (R-15). A grant becomes a governance.capabilities item
// from the capability-policy producer, and the snapshot's `capabilities` names the allow-list and the granted ids.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from '../harness/adapters.mjs';

export const SOURCE = path.join(ROOT, 'scenarios', 'advanced', 'source');
export const loadSource = name => JSON.parse(readFileSync(path.join(SOURCE, name), 'utf8'));

/** Match the policy's grants against the tools the servers proposed. A granted tool the servers did not propose is
 * reported and not offered; a proposed tool the policy does not grant is reported and never offered. */
export function grantTools(policy, proposed, { now }) {
  const items = [], granted = {}, missing = [];
  for (const [capId, grant] of Object.entries(policy.granted)) {
    const tool = proposed.find(t => t.server === grant.server && t.name === grant.tool);
    if (!tool) { missing.push({ cap: capId, server: grant.server, tool: grant.tool }); continue; }
    const { $schema, ...schema } = tool.inputSchema ?? { type: 'object' };  // the SDK's draft marker is not part of the spec offered
    granted[capId] = { ...grant, schema, description: tool.description };
    items.push({
      id: capId, slot: 'governance.capabilities', source: `capability-policy:${policy.allow_list_version}`, source_version: policy.allow_list_version,
      authority: 'governing', trust: 'verified', freshness: now, token_budget: null, variants: [], conflict_policy: 'governs', lineage: 'verbatim',
      eligibility: 'route-policy', injection_risk: 'none',
      body: JSON.stringify({ name: tool.name, description: tool.description, parameters: schema }),
    });
  }
  const grantedTools = new Set(Object.values(granted).map(g => `${g.server}/${g.tool}`));
  const notGranted = proposed.filter(t => !grantedTools.has(`${t.server}/${t.name}`)).map(t => ({ server: t.server, tool: t.name, why: policy.not_granted?.[t.name] ?? 'not on the allow-list' }));
  return {
    items,
    grant: { policy_producer: policy.policy_producer, allow_list_version: policy.allow_list_version, allowed_ids: Object.keys(granted) },
    granted, notGranted, missing,
  };
}
