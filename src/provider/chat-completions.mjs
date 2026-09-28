// The adapter for any OpenAI-compatible chat completions endpoint: OpenAI itself, or a local model served by
// Ollama, LM Studio, vLLM or llama.cpp. A cwa-messages/v1 payload in, the model's answer out, with the exact
// outbound request captured before it is sent. Plain HTTP: the request is one POST, and no SDK is needed.
// Every `system` entry becomes part of the one system message (some local servers honor only the first), every
// `tools` entry a function definition, and the single user message is sent as is.
import { performance } from 'node:perf_hooks';

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

const trim = url => url.replace(/\/+$/, '');
const headers = apiKey => ({ 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) });

function fail(message) {
  const error = new Error(message);
  error.status = 502;
  return error;
}

/** The model ids `<base_url>/models` lists, or a reason it could not be asked. Used to discover a local model. */
export async function listModels({ baseUrl, apiKey, fetch: doFetch = globalThis.fetch, timeoutMs = 1500 } = {}) {
  const url = `${trim(baseUrl)}/models`;
  try {
    const response = await doFetch(url, { headers: headers(apiKey), signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return { models: [], reason: `${url} answered ${response.status}` };
    const body = await response.json();
    return { models: (body.data ?? []).map(entry => entry.id).filter(id => typeof id === 'string') };
  } catch (error) {
    return { models: [], reason: `cannot reach ${url} (${error.name === 'TimeoutError' ? 'timed out' : error.message})` };
  }
}

/** POST the request to `<base_url>/chat/completions` and return the answer with the request that produced it. */
export async function answer(payloadText, { baseUrl, apiKey, model, maxTokens, maxTokensField, extra, fetch: doFetch = globalThis.fetch } = {}) {
  const request = toRequest(payloadText, { model, maxTokens, maxTokensField, extra });
  const url = `${trim(baseUrl)}/chat/completions`;
  const start = performance.now();
  let response;
  try {
    response = await doFetch(url, { method: 'POST', headers: headers(apiKey), body: JSON.stringify(request) });
  } catch (error) {
    throw fail(`cannot reach ${url}: ${error.message}`);
  }
  const text = await response.text();
  if (!response.ok) throw fail(`${url} answered ${response.status}: ${text.slice(0, 300)}`);
  let body;
  try { body = JSON.parse(text); } catch { throw fail(`${url} did not answer with JSON: ${text.slice(0, 300)}`); }
  const choice = body.choices?.[0];
  if (!choice) throw fail(`${url} answered without choices: ${text.slice(0, 300)}`);
  return {
    request: { url, ...request },
    text: choice.message?.content ?? '',
    reasoning: choice.message?.reasoning_content ?? choice.message?.reasoning ?? null,
    tool_calls: choice.message?.tool_calls ?? [],
    model: body.model ?? request.model,
    stop_reason: choice.finish_reason ?? null,
    stop_details: null,
    usage: body.usage ? { input_tokens: body.usage.prompt_tokens, output_tokens: body.usage.completion_tokens } : null,
    fallbacks: [],
    durationMs: Math.round(performance.now() - start),
  };
}
