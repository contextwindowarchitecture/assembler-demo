#!/usr/bin/env node
// The tickets MCP server: a user's recent tickets, and a tool that closes one. The application's capability policy
// never offers close_ticket to the model on this route; the server exposes it all the same, as a real server would.
import { z } from 'zod';
import { faultsFor, maybeFault, serve, service, text, toolError } from './common.mjs';

const faults = faultsFor('tickets');
await serve('tickets', server => {
  server.registerTool('list_tickets', {
    title: 'List tickets',
    description: 'The recent support tickets of a user, newest first: id, severity, status, subject and last update.',
    inputSchema: { user_id: z.string().describe('The user id') },
  }, async ({ user_id }) => {
    try { await maybeFault(faults); } catch (error) { return toolError(error.message); }
    const tickets = service('tickets')[user_id];
    if (!tickets) return toolError(`no tickets for user ${user_id}`);
    return text({ user_id, tickets });
  });
  server.registerTool('close_ticket', {
    title: 'Close ticket',
    description: 'Closes a support ticket. Changes state.',
    inputSchema: { ticket_id: z.string() },
  }, async ({ ticket_id }) => text({ ticket_id, status: 'closed' }));
});
