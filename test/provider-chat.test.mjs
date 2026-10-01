// The chat completions adapter (a local model, or OpenAI, through the official OpenAI SDK) maps a cwa-messages/v1
// payload to one request without adding content, and the provider index describes and dispatches to the three
// providers. The SDK client is injected, so nothing here reaches a server.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import OpenAI from 'openai';
import { ROOT } from '../src/harness/adapters.mjs';
import { answer, createClient, listModels, toRequest } from '../src/provider/chat-completions.mjs';
import { answer as dispatch, describeProviders, LOCAL_BASE_URL, OPENAI_BASE_URL, OPENAI_MODEL } from '../src/provider/index.mjs';

const payload = await readFile(path.join(ROOT, 'scenarios', 'basic', '03-authority', 'expected.messages.payload.txt'), 'utf8');
const home = { HOME: path.join(ROOT, 'test', 'no-such-home') };

/** A fake SDK client: `models.list` and `chat.completions.create` answer as told, and record what they were given. */
function fakeClient({ baseURL = 'http://x/v1', models = [], completion, fail } = {}) {
  const calls = [];
  const throwOrReturn = value => { if (fail) throw fail; return value; };
  return {
    baseURL, calls,
    models: { list: async () => throwOrReturn({ data: models.map(id => ({ id })) }) },
    chat: { completions: { create: async params => { calls.push(params); return throwOrReturn(completion); } } },
  };
}

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

test('toRequest maps tool entries to function definitions and sends a surfaced conflict member\'s text as the renderer marked it', () => {
  const ir = {
    system: [{ id: 'a', text: '<conflict group="g-cite">\nCite sources.\n</conflict>', conflict: 'g-cite' }, { id: 'b', text: 'Be brief.' }],
    tools: [{ id: 'cap:issue_refund', text: '{"name": "issue_refund", "parameters": {"type": "object", "properties": {"order_id": {"type": "string"}}}}' }],
    messages: [{ role: 'user', content: 'hi' }],
  };
  const request = toRequest(JSON.stringify(ir), { model: 'm' });
  assert.equal(request.messages[0].content, '<conflict group="g-cite">\nCite sources.\n</conflict>\n\nBe brief.', 'the renderer marks the conflict; the provider adds nothing');
  assert.deepEqual(request.tools, [{ type: 'function', function: { name: 'issue_refund', description: '', parameters: { type: 'object', properties: { order_id: { type: 'string' } } } } }]);
});

test('createClient is the official OpenAI SDK pointed at the endpoint, with a placeholder key for a local server', () => {
  const client = createClient({ baseUrl: 'http://127.0.0.1:8000/v1/' });
  assert.ok(client instanceof OpenAI);
  assert.equal(client.baseURL, 'http://127.0.0.1:8000/v1');
  assert.equal(client.apiKey, 'local');
  assert.equal(createClient({ baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-x' }).apiKey, 'sk-x');
});

test('answer sends the captured request through chat.completions.create and returns the text and usage', async () => {
  const client = fakeClient({ baseURL: 'http://127.0.0.1:11434/v1', completion: { model: 'llama3.1:8b', choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Pro includes 24x5 email and chat support [kb:support-plans:v7#pro].' } }], usage: { prompt_tokens: 310, completion_tokens: 38 } } });
  const result = await answer(payload, { model: 'llama3.1', maxTokens: 400, client });
  assert.equal(client.calls.length, 1);
  assert.deepEqual({ url: 'http://127.0.0.1:11434/v1/chat/completions', ...client.calls[0] }, result.request, 'the request returned is the one sent');
  assert.equal(result.text, 'Pro includes 24x5 email and chat support [kb:support-plans:v7#pro].');
  assert.equal(result.model, 'llama3.1:8b');
  assert.equal(result.stop_reason, 'stop');
  assert.deepEqual(result.usage, { input_tokens: 310, output_tokens: 38 });
  assert.equal(result.reasoning, null);
});

test('answer keeps a reasoning model\'s reasoning beside its (possibly empty) text', async () => {
  const client = fakeClient({ completion: { choices: [{ finish_reason: 'length', message: { role: 'assistant', reasoning_content: 'thinking about it' } }], usage: { prompt_tokens: 5, completion_tokens: 400 } } });
  const result = await answer(payload, { model: 'gpt-oss', client, extra: { reasoning_effort: 'low' } });
  assert.equal(result.text, '');
  assert.equal(result.reasoning, 'thinking about it');
  assert.equal(result.stop_reason, 'length');
  assert.equal(result.request.reasoning_effort, 'low');
});

test('answer reports the SDK\'s typed errors plainly, most specific first', async () => {
  const at = (fail) => answer(payload, { model: 'm', client: fakeClient({ fail }) });
  await assert.rejects(at(new OpenAI.AuthenticationError(401, { message: 'bad key' }, 'bad key', new Headers())), /authentication failed at http:\/\/x\/v1\/chat\/completions: 401 bad key/);
  await assert.rejects(at(new OpenAI.NotFoundError(404, { message: 'no such model' }, 'no such model', new Headers())), /answered 404/);
  await assert.rejects(at(new OpenAI.APIConnectionError({ message: 'Connection error.' })), /cannot reach http:\/\/x\/v1\/chat\/completions: Connection error\./);
  await assert.rejects(answer(payload, { model: 'm', client: fakeClient({ completion: { error: 'x' } }) }), /without choices/);
});

test('listModels returns the ids a server lists, or why it could not be asked', async () => {
  assert.deepEqual(await listModels({ baseUrl: 'http://x/v1', client: fakeClient({ models: ['llama3.1', 'qwen2.5'] }) }), { models: ['llama3.1', 'qwen2.5'] });
  const dead = await listModels({ baseUrl: 'http://x/v1', client: fakeClient({ fail: new OpenAI.APIConnectionError({ message: 'Connection error.' }) }) });
  assert.match(dead.reason, /cannot reach http:\/\/x\/v1\/models/);
});

test('describeProviders reports local, anthropic and openai from the environment, discovering the local model', async () => {
  const dead = () => fakeClient({ fail: new OpenAI.APIConnectionError({ message: 'Connection error.' }) });
  const none = await describeProviders({ ...home }, { createClient: dead });
  assert.deepEqual(none.map(p => [p.id, p.configured]), [['local', false], ['anthropic', false], ['openai', false]]);
  assert.match(none[0].reason, /cannot reach http:\/\/localhost:11434\/v1\/models/);
  assert.match(none[2].reason, /OPENAI_API_KEY/);
  const some = await describeProviders({ ...home, OPENAI_API_KEY: 'k', ANTHROPIC_API_KEY: 'k' }, { createClient: () => fakeClient({ models: ['llama3.1'] }) });
  assert.deepEqual(some.map(p => [p.id, p.configured, p.model]), [['local', true, 'llama3.1'], ['anthropic', true, 'claude-opus-5'], ['openai', true, OPENAI_MODEL]]);
  assert.equal(some[0].base_url, LOCAL_BASE_URL);
  assert.equal(some[2].base_url, OPENAI_BASE_URL);
  const named = await describeProviders({ ...home, CWA_DEMO_LOCAL_MODEL: 'qwen2.5:7b', CWA_DEMO_LOCAL_BASE_URL: 'http://127.0.0.1:1234/v1' }, { createClient: dead });
  assert.deepEqual([named[0].configured, named[0].model, named[0].base_url], [true, 'qwen2.5:7b', 'http://127.0.0.1:1234/v1']);
  assert.ok((await describeProviders({ ...home, CWA_DEMO_PROVIDERS: 'off' })).every(p => p.reason === 'CWA_DEMO_PROVIDERS=off'));
});

test('answer dispatches by provider id, with the token field each API expects, and refuses an unconfigured one', async () => {
  const made = [];
  const createClient = config => { const client = fakeClient({ baseURL: config.baseUrl, models: ['llama3.1'], completion: { choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] } }); made.push({ config, client }); return client; };
  const local = await dispatch(payload, { provider: 'local', maxTokens: 400, env: { ...home }, createClient });
  assert.equal(local.provider, 'local');
  assert.equal(local.text, 'answer');
  const localSend = made.find(m => m.client.calls.length);
  assert.equal(localSend.client.calls[0].max_tokens, 400);
  assert.equal(localSend.config.apiKey, undefined);
  assert.equal('reasoning_effort' in localSend.client.calls[0], false);
  made.length = 0;
  await dispatch(payload, { provider: 'local', env: { ...home, CWA_DEMO_LOCAL_MODEL: 'gpt-oss', CWA_DEMO_LOCAL_REASONING_EFFORT: 'low' }, createClient });
  assert.equal(made.find(m => m.client.calls.length).client.calls[0].reasoning_effort, 'low');
  made.length = 0;
  const openai = await dispatch(payload, { provider: 'openai', maxTokens: 400, env: { ...home, OPENAI_API_KEY: 'sk-openai' }, createClient });
  assert.equal(openai.provider, 'openai');
  const openaiSend = made.find(m => m.client.calls.length);
  assert.equal(openaiSend.config.baseUrl, 'https://api.openai.com/v1');
  assert.equal(openaiSend.config.apiKey, 'sk-openai');
  assert.equal(openaiSend.client.calls[0].max_completion_tokens, 400);
  assert.equal('max_tokens' in openaiSend.client.calls[0], false);
  await assert.rejects(dispatch(payload, { provider: 'openai', env: { ...home }, createClient }), /OpenAI is not configured: set OPENAI_API_KEY/);
  await assert.rejects(dispatch(payload, { provider: 'cobol', env: { ...home }, createClient }), /unknown provider cobol/);
});
