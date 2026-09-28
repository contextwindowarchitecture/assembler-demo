// The MCP servers are real servers over the local services: the client lists what they propose, calls a tool, sees
// the status timeline advance, and gets a timeout as a result rather than an exception when a fault is injected.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { connectServers } from '../src/agent/mcp.mjs';

let mcp;
before(async () => { mcp = await connectServers({ faults: { tickets: ['timeout'] } }); });
after(async () => { await mcp.close(); });

test('the servers propose their tools, including one the route will never grant', () => {
  assert.deepEqual(mcp.proposed.map(t => `${t.server}/${t.name}`), ['accounts/get_account', 'status/get_service_status', 'tickets/list_tickets', 'tickets/close_ticket']);
  const status = mcp.proposed.find(t => t.name === 'get_service_status');
  assert.deepEqual(status.inputSchema.properties.region.enum, ['eu', 'us', 'apac']);
  assert.deepEqual(status.inputSchema.required, ['region']);
});

test('get_account answers for any user it knows; scope is not the server\'s job', async () => {
  const mine = await mcp.call('accounts', 'get_account', { user_id: 'u_1042' });
  assert.equal(mine.ok, true);
  assert.equal(mine.value.plan, 'pro');
  const other = await mcp.call('accounts', 'get_account', { user_id: 'u_77' });
  assert.equal(other.ok, true, 'the server does not know who is asking');
  const none = await mcp.call('accounts', 'get_account', { user_id: 'u_0' });
  assert.equal(none.ok, false);
  assert.match(none.error, /no account/);
});

test('the status timeline advances per call, so a later observation can supersede an earlier one', async () => {
  const first = await mcp.call('status', 'get_service_status', { region: 'eu' });
  const second = await mcp.call('status', 'get_service_status', { region: 'eu' });
  const third = await mcp.call('status', 'get_service_status', { region: 'eu' });
  assert.equal(first.value.state, 'degraded');
  assert.equal(second.value.state, 'operational');
  assert.equal(third.value.state, 'operational', 'the last entry repeats');
  assert.equal((await mcp.call('status', 'get_service_status', { region: 'us' })).value.incident, null);
});

test('an injected timeout is a result, not an exception, and the next call succeeds', async () => {
  const timedOut = await mcp.call('tickets', 'list_tickets', { user_id: 'u_1042' }, { timeoutMs: 300 });
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.timeout, true);
  assert.match(timedOut.error, /timeout after 300 ms/);
  const ok = await mcp.call('tickets', 'list_tickets', { user_id: 'u_1042' });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.tickets.length, 2);
});
