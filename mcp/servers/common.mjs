// What the three MCP servers share: the service data, fault injection, and the stdio start.
// Faults come from CWA_DEMO_FAULTS, a JSON object of server name to a list of faults consumed one per call:
// "timeout" holds the answer past any client timeout, "error" answers with an MCP tool error.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const SERVICES = path.join(ROOT, 'scenarios', 'advanced', 'source', 'services');

export const service = name => JSON.parse(readFileSync(path.join(SERVICES, `${name}.json`), 'utf8'));

export function faultsFor(server) {
  try { return [...(JSON.parse(process.env.CWA_DEMO_FAULTS ?? '{}')[server] ?? [])]; } catch { return []; }
}

/** Apply the next injected fault, if any: never resolves on "timeout", throws on "error", otherwise returns. */
export async function maybeFault(faults) {
  const fault = faults.shift();
  if (fault === 'timeout') await new Promise(() => {});
  if (fault === 'error') throw new Error('the service is unavailable (injected fault)');
}

export const text = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
export const toolError = message => ({ content: [{ type: 'text', text: JSON.stringify({ error: message }) }], isError: true });

export async function serve(name, register) {
  const server = new McpServer({ name: `cwa-demo-${name}`, version: '0.1.0' });
  register(server);
  await server.connect(new StdioServerTransport());
}
