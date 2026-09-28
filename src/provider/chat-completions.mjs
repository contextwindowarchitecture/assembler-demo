// The adapter for any OpenAI-compatible chat completions endpoint through the official OpenAI SDK: OpenAI itself, or
// a local model served by Ollama, LM Studio, vLLM or llama.cpp, which is the same client with a baseURL. A
// cwa-messages/v1 payload in, the model's answer out, with the exact outbound request captured before it is sent.
// Every `system` entry becomes part of the one system message (some local servers honor only the first), every
// `tools` entry a function definition, and the single user message is sent as is.
import { performance } from 'node:perf_hooks';
import OpenAI from 'openai';

const trim = url => String(url).replace(/\/+$/, '');

/** The SDK client for an endpoint. A local server that checks no key still needs a non-empty one for the SDK. */
export function createClient({ baseUrl, apiKey, timeoutMs = 120_000 }) {
  return new OpenAI({ baseURL: trim(baseUrl), apiKey: apiKey || 'local', timeout: timeoutMs, maxRetries: 0 });
}

function toTool(entry) {
  let spec;
  try { spec = JSON.parse(entry.text); } catch { throw new Error(`tool ${entry.id} is not a JSON tool specification`); }
  if (!spec || typeof spec.name !== 'string') throw new Error(`tool ${entry.id} has no name`);
  return {
    type: 'function',
    function: {
      name: spec.name,
      description: typeof spec.description === 'string' ? spec.description : '',
      parameters: spec.parameters ?? spec.input_schema ?? { type: 'object', properties: {} },
    },
  };
}

/** The chat completions request for a cwa-messages/v1 payload. `maxTokensField` is `max_tokens` for local servers
 * and `max_completion_tokens` for OpenAI, whose reasoning models reject the older name. Throws when the payload is
 * not a cwa-messages/v1 document. */
export function toRequest(payloadText, { model, maxTokens = 4096, maxTokensField = 'max_tokens', extra = {} } = {}) {
  if (!model) throw new Error('no model named');
  let ir;
  try { ir = JSON.parse(payloadText); } catch { throw new Error('the payload is not a cwa-messages/v1 document'); }
  if (!ir || !Array.isArray(ir.system) || !Array.isArray(ir.tools) || !Array.isArray(ir.messages) || ir.messages.length !== 1) {
    throw new Error('the payload is not a cwa-messages/v1 document: it needs system, tools and exactly one message');
  }
  const system = ir.system.map(entry => (entry.conflict ? `[This instruction conflicts with another, conflict group ${entry.conflict}.]\n${entry.text}` : entry.text));
  const request = {
    model,
    [maxTokensField]: maxTokens,
    messages: [
      ...(system.length ? [{ role: 'system', content: system.join('\n\n') }] : []),
      ...ir.messages.map(message => ({ role: message.role, content: message.content })),
    ],
    ...extra,
  };
  if (ir.tools.length) request.tools = ir.tools.map(toTool);
  return request;
}

/** The SDK's typed errors in words, most specific first. APIConnectionError extends APIError in this SDK, so it is
 * tested before the general case. The result carries status 502 for the inspector. */
function describe(error, url) {
  const message = error instanceof OpenAI.AuthenticationError ? `authentication failed at ${url}: ${error.message}`
    : error instanceof OpenAI.NotFoundError ? `${url} answered 404: ${error.message}`
    : error instanceof OpenAI.RateLimitError ? `rate limited at ${url}: ${error.message}`
    : error instanceof OpenAI.APIConnectionError ? `cannot reach ${url}: ${error.message}`
    : error instanceof OpenAI.APIError ? `${url} answered ${error.status}: ${error.message}`
    : error.message;
  const wrapped = new Error(message);
  wrapped.status = 502;
  return wrapped;
}

/** The model ids the endpoint lists, or a reason it could not be asked. Used to discover a local model. */
export async function listModels({ baseUrl, apiKey, client, timeoutMs = 1500 } = {}) {
  const api = client ?? createClient({ baseUrl, apiKey, timeoutMs });
  try {
    const page = await api.models.list();
    return { models: (page.data ?? []).map(entry => entry.id).filter(id => typeof id === 'string') };
  } catch (error) {
    return { models: [], reason: describe(error, `${trim(baseUrl)}/models`).message };
  }
}

/** Tool calls in one shape for the application: {id, name, arguments}, with the arguments parsed (never string-matched). */
export function normaliseToolCalls(calls) {
  return (calls ?? []).map(call => {
    let args;
    try { args = JSON.parse(call.function?.arguments ?? '{}'); } catch { args = { _unparsable: call.function?.arguments }; }
    return { id: call.id, name: call.function?.name, arguments: args };
  });
}

/** Send the request with `client.chat.completions.create` and return the answer with the request that produced it. */
export async function answer(payloadText, { baseUrl, apiKey, model, maxTokens, maxTokensField, extra, client } = {}) {
  const request = toRequest(payloadText, { model, maxTokens, maxTokensField, extra });
  const api = client ?? createClient({ baseUrl, apiKey });
  const url = `${trim(api.baseURL ?? baseUrl)}/chat/completions`;
  const start = performance.now();
  let completion;
  try {
    completion = await api.chat.completions.create(request);
  } catch (error) {
    throw describe(error, url);
  }
  const choice = completion?.choices?.[0];
  if (!choice) { const error = new Error(`${url} answered without choices`); error.status = 502; throw error; }
  return {
    request: { url, ...request },
    text: choice.message?.content ?? '',
    reasoning: choice.message?.reasoning_content ?? choice.message?.reasoning ?? null,
    tool_calls: normaliseToolCalls(choice.message?.tool_calls),
    model: completion.model ?? request.model,
    stop_reason: choice.finish_reason ?? null,
    stop_details: null,
    usage: completion.usage ? { input_tokens: completion.usage.prompt_tokens, output_tokens: completion.usage.completion_tokens } : null,
    fallbacks: [],
    durationMs: Math.round(performance.now() - start),
  };
}
