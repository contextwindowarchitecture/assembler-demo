#!/usr/bin/env node
// The accounts MCP server: one tool, the workspace account of a user. It answers for any user it knows; deciding
// which users the model may ask about is the application's, not the server's (R-15).
import { z } from 'zod';
import { faultsFor, maybeFault, serve, service, text, toolError } from './common.mjs';

const faults = faultsFor('accounts');
await serve('accounts', server => {
  server.registerTool('get_account', {
    title: 'Get account',
    description: 'The workspace account of a user: plan, seats, region, renewal date and support contact.',
    inputSchema: { user_id: z.string().describe('The user id, for example u_1042') },
  }, async ({ user_id }) => {
    try { await maybeFault(faults); } catch (error) { return toolError(error.message); }
    const account = service('accounts')[user_id];
    if (!account) return toolError(`no account for user ${user_id}`);
    return text({ user_id, ...account });
  });
});
