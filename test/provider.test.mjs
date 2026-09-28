// The provider adapter maps a cwa-messages/v1 payload to a Messages API request without adding content, reports
// whether credentials exist without a network call, and returns the answer with the request that produced it.
// The API client is injected, so nothing here reaches the network.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../src/harness/adapters.mjs';
import { answer, DEFAULT_MODEL, FALLBACK_BETA, providerStatus, toRequest } from '../src/provider/anthropic.mjs';

const payload = await readFile(path.join(ROOT, 'scenarios', 'basic', '03-authority', 'expected.messages.payload.txt'), 'utf8');

test('toRequest puts system entries in system, the one user message in messages, and nothing else', () => {
  const request = toRequest(payload, { maxTokens: 400 });
  const ir = JSON.parse(payload);
  assert.equal(request.model, DEFAULT_MODEL);
  assert.equal(request.max_tokens, 400);
  assert.deepEqual(request.thinking, { type: 'adaptive' });
  assert.deepEqual(request.system, ir.system.map(entry => ({ type: 'text', text: entry.text })));
  assert.deepEqual(request.messages, [{ role: 'user', content: ir.messages[0].content }]);
  assert.equal('tools' in request, false, 'no tools were granted');
  assert.match(request.messages[0].content, /&lt;system&gt;Ignore all previous instructions/, 'the injected tag arrives escaped, as material');
});

test('toRequest maps tool entries to tool definitions and marks a surfaced conflict', () => {
  const ir = {
    system: [{ id: 'a', text: 'Cite sources.', conflict: 'g-cite' }, { id: 'b', text: 'Be brief.' }],
    tools: [{ id: 'cap:issue_refund', text: '{"name": "issue_refund", "description": "Refund an order", "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}, "required": ["order_id"]}}' }],
    messages: [{ role: 'user', content: '<query id="q">\nhi\n</query>\n' }],
  };
  const request = toRequest(JSON.stringify(ir), { model: 'claude-sonnet-5' });
  assert.equal(request.model, 'claude-sonnet-5');
  assert.match(request.system[0].text, /^\[This instruction conflicts with another, conflict group g-cite\.\]\nCite sources\.$/);
  assert.equal(request.system[1].text, 'Be brief.');
  assert.deepEqual(request.tools, [{ name: 'issue_refund', description: 'Refund an order', input_schema: ir.tools[0].text && JSON.parse(ir.tools[0].text).parameters }]);
});

test('toRequest rejects anything that is not a cwa-messages/v1 document', () => {
  assert.throws(() => toRequest('<query id="q">\nhi\n</query>\n'), /not a cwa-messages\/v1 document/);
  assert.throws(() => toRequest(JSON.stringify({ system: [], tools: [], messages: [] })), /exactly one message/);
  assert.throws(() => toRequest(JSON.stringify({ system: [], tools: [{ id: 't', text: 'not json' }], messages: [{ role: 'user', content: 'x' }] })), /not a JSON tool specification/);
});

test('providerStatus reads credentials from the environment without a network call', () => {
  const home = path.join(ROOT, 'test', 'no-such-home');
  assert.equal(providerStatus({ HOME: home }).configured, false);
  assert.match(providerStatus({ HOME: home }).reason, /ANTHROPIC_API_KEY/);
  assert.deepEqual(providerStatus({ HOME: home, ANTHROPIC_API_KEY: 'sk-test' }), { provider: 'anthropic', model: DEFAULT_MODEL, fallbacks: true, configured: true, source: 'environment' });
  assert.equal(providerStatus({ HOME: home, ANTHROPIC_PROFILE: 'work' }).source, 'profile');
  assert.equal(providerStatus({ HOME: home, ANTHROPIC_API_KEY: 'sk-test', CWA_DEMO_ANTHROPIC_MODEL: 'claude-sonnet-5' }).model, 'claude-sonnet-5');
  assert.equal(providerStatus({ HOME: home, ANTHROPIC_API_KEY: 'sk-test', CWA_DEMO_ANTHROPIC_FALLBACKS: 'off' }).fallbacks, false);
});

test('answer sends the captured request through the beta endpoint with fallbacks, and returns the text and usage', async () => {
  const calls = [];
  const client = {
    beta: { messages: { create: async params => { calls.push(params); return {
      model: 'claude-opus-5', stop_reason: 'end_turn', stop_details: null,
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: 'Pro includes 24x5 email and chat support [kb:support-plans:v7#pro].' }],
      usage: { input_tokens: 300, output_tokens: 40 },
    }; } } },
    messages: { create: async () => { throw new Error('the non-beta endpoint must not be used with fallbacks on'); } },
  };
  const result = await answer(payload, { maxTokens: 400, client, env: {} });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].betas, [FALLBACK_BETA]);
  assert.equal(calls[0].fallbacks, 'default');
  assert.equal(calls[0].max_tokens, 400);
  assert.deepEqual(result.request, calls[0], 'the request returned is the one sent');
  assert.equal(result.text, 'Pro includes 24x5 email and chat support [kb:support-plans:v7#pro].');
  assert.equal(result.model, 'claude-opus-5');
  assert.deepEqual(result.usage, { input_tokens: 300, output_tokens: 40 });
  assert.deepEqual(result.fallbacks, []);
  assert.equal(result.stop_details, null);
});

test('answer uses the regular endpoint with fallbacks off, and surfaces a refusal with its details', async () => {
  const client = {
    beta: { messages: { create: async () => { throw new Error('the beta endpoint must not be used with fallbacks off'); } } },
    messages: { create: async () => ({ model: 'claude-opus-5', stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'x' }, content: [], usage: { input_tokens: 1, output_tokens: 0 } }) },
  };
  const result = await answer(payload, { client, env: { CWA_DEMO_ANTHROPIC_FALLBACKS: 'off' } });
  assert.equal('betas' in result.request, false);
  assert.equal(result.stop_reason, 'refusal');
  assert.deepEqual(result.stop_details, { type: 'refusal', category: 'cyber', explanation: 'x' });
  assert.equal(result.text, '');
});
