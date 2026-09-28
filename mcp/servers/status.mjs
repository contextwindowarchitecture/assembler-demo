#!/usr/bin/env node
// The service-status MCP server: the current status of a region. Each region has a timeline, and successive calls
// return successive entries (the last one repeats), so a run observes an incident and then its resolution.
import { z } from 'zod';
import { faultsFor, maybeFault, serve, service, text, toolError } from './common.mjs';

const faults = faultsFor('status');
const calls = new Map();
await serve('status', server => {
  server.registerTool('get_service_status', {
    title: 'Get service status',
    description: 'The current status of the Acme Cloud service in a region: state, open incident, severity, summary and when it was updated.',
    inputSchema: { region: z.enum(['eu', 'us', 'apac']).describe('The workspace home region') },
  }, async ({ region }) => {
    try { await maybeFault(faults); } catch (error) { return toolError(error.message); }
    const timeline = service('status')[region];
    const index = Math.min(calls.get(region) ?? 0, timeline.length - 1);
    calls.set(region, index + 1);
    return text({ region, ...timeline[index] });
  });
});
