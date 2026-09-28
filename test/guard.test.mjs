// The guard decides every tool request from the grant, the tool's schema and the scope rule; the model's wording
// plays no part. A server proposing a tool is not a grant, and a valid call for another user is denied.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { grantTools, loadSource } from '../src/agent/capabilities.mjs';
import { authorize } from '../src/agent/guard.mjs';

const proposed = [
  { server: 'accounts', name: 'get_account', description: 'account', inputSchema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false } },
  { server: 'status', name: 'get_service_status', description: 'status', inputSchema: { type: 'object', properties: { region: { type: 'string', enum: ['eu', 'us', 'apac'] } }, required: ['region'], additionalProperties: false } },
  { server: 'tickets', name: 'list_tickets', description: 'tickets', inputSchema: { type: 'object', properties: { user_id: { type: 'string' } }, required: ['user_id'], additionalProperties: false } },
  { server: 'tickets', name: 'close_ticket', description: 'close', inputSchema: { type: 'object', properties: { ticket_id: { type: 'string' } }, required: ['ticket_id'] } },
];
const grant = grantTools(loadSource('capabilities.json'), proposed, { now: '2026-09-28T16:00:00Z' });
const context = { granted: grant.granted, proposed, scope: { tenant: 'acme', user: 'u_1042', session: 's_104', task: 'incident_investigation' }, account: { region: 'eu' } };

test('grantTools offers only the allow-listed tools, as governance.capabilities items with the tool spec as body', () => {
  assert.deepEqual(grant.grant, { policy_producer: 'capability-policy', allow_list_version: 'incident-agent/v2', allowed_ids: ['cap:get_account', 'cap:get_service_status', 'cap:list_tickets'] });
  assert.deepEqual(grant.items.map(i => [i.id, i.slot, i.authority, i.trust, i.injection_risk]), [['cap:get_account', 'governance.capabilities', 'governing', 'verified', 'none'], ['cap:get_service_status', 'governance.capabilities', 'governing', 'verified', 'none'], ['cap:list_tickets', 'governance.capabilities', 'governing', 'verified', 'none']]);
  assert.equal(JSON.parse(grant.items[1].body).parameters.properties.region.enum.length, 3);
  assert.deepEqual(grant.notGranted, [{ server: 'tickets', tool: 'close_ticket', why: 'changes state; not on this route' }]);
  assert.deepEqual(grant.missing, []);
});

test('an approved call names its grant; a call for another user, a wrong region or a bad argument is denied', () => {
  assert.equal(authorize({ name: 'get_account', arguments: { user_id: 'u_1042' } }, context).decision, 'approved');
  assert.equal(authorize({ name: 'get_service_status', arguments: { region: 'eu' } }, context).decision, 'approved');
  const other = authorize({ name: 'get_account', arguments: { user_id: 'u_77' } }, context);
  assert.equal(other.decision, 'denied');
  assert.match(other.reason, /user_id="u_77" is outside the request's scope \(request\.user is "u_1042"\)/);
  assert.match(authorize({ name: 'get_service_status', arguments: { region: 'us' } }, context).reason, /account\.region is "eu"/);
  assert.match(authorize({ name: 'get_service_status', arguments: { region: 'mars' } }, context).reason, /do not match the tool's schema/);
  assert.match(authorize({ name: 'get_account', arguments: {} }, context).reason, /must have required property 'user_id'/);
});

test('a tool a server proposes but the route does not grant is denied, and so is an unknown tool', () => {
  assert.match(authorize({ name: 'close_ticket', arguments: { ticket_id: 'T-1' } }, context).reason, /not granted on this route/);
  assert.match(authorize({ name: 'delete_workspace', arguments: {} }, context).reason, /not a tool this route knows/);
});
