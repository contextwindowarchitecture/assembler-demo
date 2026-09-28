// The application's side of MCP: start the servers, list the tools they propose, call an approved tool with a
// timeout, and close them. Proposals are not grants: the capability policy decides what the model is offered
// (R-15), and the guard decides every call. A tool's result is an observation, never an instruction.
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT } from '../harness/adapters.mjs';

export const SERVERS = ['accounts', 'status', 'tickets'];

/** Connect to every server. `faults` is the CWA_DEMO_FAULTS object the servers read. */
export async function connectServers({ faults = {}, servers = SERVERS, root = ROOT } = {}) {
  const clients = new Map();
  const proposed = [];
  for (const name of servers) {
    const client = new Client({ name: 'cwa-demo-controller', version: '0.1.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [path.join(root, 'mcp', 'servers', `${name}.mjs`)],
      env: { ...process.env, CWA_DEMO_FAULTS: JSON.stringify(faults) },
      stderr: 'pipe',
    });
    await client.connect(transport);
    const { tools } = await client.listTools();
    for (const tool of tools) proposed.push({ server: name, name: tool.name, description: tool.description ?? '', inputSchema: tool.inputSchema });
    clients.set(name, client);
  }
  return {
    proposed,
    /** Call a tool. Resolves to {ok, value|error, ms}; a timeout or a server error is a result, not an exception. */
    async call(server, name, args, { timeoutMs = 2000 } = {}) {
      const client = clients.get(server);
      if (!client) return { ok: false, error: `no server ${server}`, ms: 0 };
      const start = performance.now();
      try {
        const result = await client.callTool({ name, arguments: args }, undefined, { timeout: timeoutMs });
        const content = (result.content ?? []).filter(block => block.type === 'text').map(block => block.text).join('');
        let value;
        try { value = JSON.parse(content); } catch { value = content; }
        if (result.isError) return { ok: false, error: value?.error ?? content, ms: Math.round(performance.now() - start) };
        return { ok: true, value, ms: Math.round(performance.now() - start) };
      } catch (error) {
        const timedOut = /timed out|timeout/i.test(error.message);
        return { ok: false, error: timedOut ? `timeout after ${timeoutMs} ms` : error.message, timeout: timedOut, ms: Math.round(performance.now() - start) };
      }
    },
    async close() {
      for (const client of clients.values()) await client.close().catch(() => {});
    },
  };
}
