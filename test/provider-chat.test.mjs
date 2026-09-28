// The chat completions adapter (a local model, or OpenAI) maps a cwa-messages/v1 payload to one request without
// adding content, and the provider index describes and dispatches to the three providers. fetch is injected, so
// nothing here reaches a server.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../src/harness/adapters.mjs';
import { answer, listModels, toRequest } from '../src/provider/chat-completions.mjs';
import { answer as dispatch, describeProviders, LOCAL_BASE_URL, OPENAI_BASE_URL, OPENAI_MODEL } from '../src/provider/index.mjs';

const payload = await readFile(path.join(ROOT, 'scenarios', 'basic', '03-authority', 'expected.messages.payload.txt'), 'utf8');
const home = { HOME: path.join(ROOT, 'test', 'no-such-home') };
const ok = body => async () => ({ ok: true, status: 200, text: async () => JSON.stringify(body), json: async () => body });
const unreachable = async () => { throw new Error('ECONNREFUSED'); };

test('toRequest joins system entries into one system message ahead of the one user message', () => {
  const ir = JSON.parse(payload);
  const request = toRequest(payload, { model: 'llama3.1', maxTokens: 400 });
  assert.deepEqual(request, {
    model: 'llama3.1', max_tokens: 400,
    messages: [{ role: 'system', content: ir.system[0].text }, { role: 'user', content: ir.messages[0].content }],
  });
  assert.equal(toRequest(payload, { model: 'gpt-5', maxTokens: 400, maxTokensField: 'max_completion_tokens' }).max_completion_tokens, 400);
  assert.throws(() => toRequest(payload, {}), /no model/);
  assert.throws(() => toRequest('<query/>', { model: 'm' }), /not a cwa-messages\/v1 document/);
});

test('toRequest maps tool entries to function definitions and marks a surfaced conflict', () => {
  const ir = {
    system: [{ id: 'a', text: 'Cite sources.', conflict: 'g-cite' }, { id: 'b', text: 'Be brief.' }],
    tools: [{ id: 'cap:issue_refund', text: '{"name": "issue_refund", "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}}}' }],
    messages: [{ role: 'user', content: 'hi' }],
  };
  const request = toRequest(JSON.stringify(ir), { model: 'm' });
  assert.equal(request.messages[0].content, '[This instruction conflicts with another, conflict group g-cite.]\nCite sources.\n\nBe brief.');
  assert.deepEqual(request.tools, [{ type: 'function', function: { name: 'issue_refund', description: '', parameters: { type: 'object', properties: { order_id: { type: 'string' } } } } }]);
});

test('answer POSTs the captured request to <base>/chat/completions and returns the text and usage', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return ok({ model: 'llama3.1:8b', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Pro includes 24x5 email and chat support [kb:support-plans:v7#pro].' } }], usage: { prompt_tokens: 310, completion_tokens: 38 } })();
  };
  const result = await answer(payload, { baseUrl: 'http://127.0.0.1:11434/v1/', model: 'llama3.1', maxTokens: 400, fetch });
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal('authorization' in calls[0].init.headers, false, 'no key, no header');
  assert.deepEqual({ url: calls[0].url, ...JSON.parse(calls[0].init.body) }, result.request, 'the request returned is the one sent');
  assert.equal(result.text, 'Pro includes 24x5 email and chat support [kb:support-plans:v7#pro].');
  assert.equal(result.model, 'llama3.1:8b');
  assert.equal(result.stop_reason, 'stop');
  assert.deepEqual(result.usage, { input_tokens: 310, output_tokens: 38 });
  assert.equal(result.reasoning, null);
});

test('answer keeps a reasoning model\'s reasoning beside its (possibly empty) text', async () => {
  const fetch = ok({ choices: [{ finish_reason: 'length', message: { role: 'assistant', reasoning_content: 'thinking about it' } }], usage: { prompt_tokens: 5, completion_tokens: 400 } });
  const result = await answer(payload, { baseUrl: 'http://x/v1', model: 'gpt-oss', fetch, extra: { reasoning_effort: 'low' } });
  assert.equal(result.text, '');
  assert.equal(result.reasoning, 'thinking about it');
  assert.equal(result.stop_reason, 'length');
  assert.equal(result.request.reasoning_effort, 'low');
});

test('answer sends a bearer key when one is given, and reports HTTP and connection failures plainly', async () => {
  let headers;
  await answer(payload, { baseUrl: 'http://x/v1', model: 'm', apiKey: 'local-key', fetch: async (url, init) => { headers = init.headers; return ok({ choices: [{ message: { content: 'x' } }] })(); } });
  assert.equal(headers.authorization, 'Bearer local-key');
  const base = { baseUrl: 'http://x/v1', model: 'm' };
  await assert.rejects(answer(payload, { ...base, fetch: async () => ({ ok: false, status: 404, text: async () => 'model not found' }) }), /answered 404: model not found/);
  await assert.rejects(answer(payload, { ...base, fetch: unreachable }), /cannot reach http:\/\/x\/v1\/chat\/completions: ECONNREFUSED/);
  await assert.rejects(answer(payload, { ...base, fetch: ok({ error: 'x' }) }), /without choices/);
});

test('listModels returns the ids a server lists, or why it could not be asked', async () => {
  assert.deepEqual(await listModels({ baseUrl: 'http://x/v1', fetch: ok({ data: [{ id: 'llama3.1' }, { id: 'qwen2.5' }] }) }), { models: ['llama3.1', 'qwen2.5'] });
  assert.match((await listModels({ baseUrl: 'http://x/v1', fetch: unreachable })).reason, /cannot reach http:\/\/x\/v1\/models/);
});

test('describeProviders reports local, anthropic and openai from the environment, discovering the local model', async () => {
  const none = await describeProviders({ ...home }, { fetch: unreachable });
  assert.deepEqual(none.map(p => [p.id, p.configured]), [['local', false], ['anthropic', false], ['openai', false]]);
  assert.match(none[0].reason, /cannot reach http:\/\/localhost:11434\/v1\/models/);
  assert.match(none[2].reason, /OPENAI_API_KEY/);
  const some = await describeProviders({ ...home, OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }, { fetch: ok({ data: [{ id: 'llama3.1' }] }) });
  assert.deepEqual(some.map(p => [p.id, p.configured, p.model]), [['local', true, 'llama3.1'], ['anthropic', true, 'claude-opus-5'], ['openai', true, OPENAI_MODEL]]);
  assert.equal(some[0].base_url, LOCAL_BASE_URL);
  assert.equal(some[2].base_url, OPENAI_BASE_URL);
  const named = await describeProviders({ ...home, CWA_DEMO_LOCAL_MODEL: 'qwen2.5:7b', CWA_DEMO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1' }, { fetch: unreachable });
  assert.deepEqual([named[0].configured, named[0].model, named[0].base_url], [true, 'qwen2.5:7b', 'http://127.0.0.1:1234/v1']);
  assert.ok((await describeProviders({ ...home, CWA_DEMO_PROVIDERS: 'off' })).every(p => p.reason === 'CWA_DEMO_PROVIDERS=off'));
});

test('answer dispatches by provider id, with the token field each API expects, and refuses an unconfigured one', async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: init.body ? JSON.parse(init.body) : null, auth: init.headers.authorization }); return ok({ data: [{ id: 'llama3.1' }], choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] })(); };
  const local = await dispatch(payload, { provider: 'local', maxTokens: 400, env: { ...home }, fetch });
  assert.equal(local.provider, 'local');
  assert.equal(local.text, 'answer');
  const localCall = calls.find(c => c.url.endsWith('/chat/completions'));
  assert.equal(localCall.body.max_tokens, 400);
  assert.equal(localCall.auth, undefined);
  assert.equal('reasoning_effort' in localCall.body, false);
  calls.length = 0;
  await dispatch(payload, { provider: 'local', env: { ...home, CWA_DEMO_LOCAL_MODEL: 'gpt-oss', CWA_DEMO_LOCAL_REASONING_EFFORT: 'low' }, fetch });
  assert.equal(calls[0].body.reasoning_effort, 'low');
  calls.length = 0;
  const openai = await dispatch(payload, { provider: 'openai', maxTokens: 400, env: { ...home, OPENAI_API_KEY: 'sk-openai' }, fetch });
  assert.equal(openai.provider, 'openai');
  assert.equal(calls[0].url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0].body.max_completion_tokens, 400);
  assert.equal('max_tokens' in calls[0].body, false);
  assert.equal(calls[0].auth, 'Bearer sk-openai');
  await assert.rejects(dispatch(payload, { provider: 'openai', env: { ...home }, fetch }), /OpenAI is not configured: set OPENAI_API_KEY/);
  await assert.rejects(dispatch(payload, { provider: 'cobol', env: { ...home }, fetch }), /unknown provider cobol/);
});
