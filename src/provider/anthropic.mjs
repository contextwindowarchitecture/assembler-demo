// The provider adapter for the Anthropic Messages API: a cwa-messages/v1 payload in, the model's answer out, with the
// exact outbound request captured before it is sent. It maps the render IR to the platform's roles (R-7): every
// `system` entry becomes a system text block, every `tools` entry a tool definition, and the single user message is
// sent as is. It adds no content of its own, apart from marking a surfaced conflict, which the renderer asks for.
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';

export const DEFAULT_MODEL = 'claude-opus-5';
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';


/** Whether a live answer can be requested, without a network call. The SDK resolves credentials from
 * ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile under ~/.config/anthropic. */
export function providerStatus(env = process.env) {
  // A custom base URL means an Anthropic-compatible server, such as a local model: it may not know the beta
  // features or the thinking parameter, so both are off unless asked for, and a placeholder key satisfies the SDK.
  const custom = env.ANTHROPIC_BASE_URL || null;
  const base = {
    provider: 'anthropic', model: env.CWA_DEMO_ANTHROPIC_MODEL || DEFAULT_MODEL, base_url: custom ?? 'https://api.anthropic.com',
    fallbacks: env.CWA_DEMO_ANTHROPIC_FALLBACKS ? env.CWA_DEMO_ANTHROPIC_FALLBACKS !== 'off' : !custom,
    thinking: env.CWA_DEMO_ANTHROPIC_THINKING ? env.CWA_DEMO_ANTHROPIC_THINKING !== 'off' : !custom,
  };
  if (env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN) return { ...base, configured: true, source: 'environment' };
  if (custom) return { ...base, configured: true, source: 'custom base URL, placeholder key' };
  const profiles = path.join(env.HOME || homedir(), '.config', 'anthropic');
  if (env.ANTHROPIC_PROFILE || (existsSync(profiles) && readdirSync(profiles).length > 0)) return { ...base, configured: true, source: 'profile' };
  return { ...base, configured: false, reason: 'no credentials: set ANTHROPIC_API_KEY, or run `ant auth login`' };
}

function toTool(entry) {
  let spec;
  try { spec = JSON.parse(entry.text); } catch { throw new Error(`tool ${entry.id} is not a JSON tool specification`); }
  if (!spec || typeof spec.name !== 'string') throw new Error(`tool ${entry.id} has no name`);
  return {
    name: spec.name,
    description: typeof spec.description === 'string' ? spec.description : '',
    input_schema: spec.input_schema ?? spec.parameters ?? { type: 'object', properties: {} },
  };
}

/** The Messages API request for a cwa-messages/v1 payload. `maxTokens` is the route's reserved output; the payload
 * was fitted to the input budget that remains after it. Throws when the payload is not a cwa-messages/v1 document. */
export function toRequest(payloadText, { model: chosen = DEFAULT_MODEL, maxTokens = 4096, thinking = true } = {}) {
  let ir;
  try { ir = JSON.parse(payloadText); } catch { throw new Error('the payload is not a cwa-messages/v1 document'); }
  if (!ir || !Array.isArray(ir.system) || !Array.isArray(ir.tools) || !Array.isArray(ir.messages) || ir.messages.length !== 1) {
    throw new Error('the payload is not a cwa-messages/v1 document: it needs system, tools and exactly one message');
  }
  const request = {
    model: chosen,
    max_tokens: maxTokens,
    ...(thinking ? { thinking: { type: 'adaptive' } } : {}),
    messages: ir.messages.map(message => ({ role: message.role, content: message.content })),
  };
  if (ir.system.length) {
    request.system = ir.system.map(entry => ({
      type: 'text',
      text: entry.conflict ? `[This instruction conflicts with another, conflict group ${entry.conflict}.]\n${entry.text}` : entry.text,
    }));
  }
  if (ir.tools.length) request.tools = ir.tools.map(toTool);
  return request;
}

function describe(error) {
  const wrapped = new Error(
    error instanceof Anthropic.AuthenticationError ? `authentication failed: ${error.message}`
      : error instanceof Anthropic.RateLimitError ? `rate limited: ${error.message}`
      : error instanceof Anthropic.APIError ? `API error ${error.status}: ${error.message}`
      : error instanceof Anthropic.APIConnectionError ? `cannot reach the API: ${error.message}`
      : error.message);
  wrapped.status = 502;
  return wrapped;
}

/**
 * Send a cwa-messages/v1 payload and return the answer with the request that produced it. With fallbacks on (the
 * default), a policy refusal is re-run on a fallback model inside the same call; the result names the model that
 * answered. `client` is injectable for tests.
 */
export async function answer(payloadText, { maxTokens, model: chosen, client, env = process.env } = {}) {
  const status = providerStatus(env);
  const request = toRequest(payloadText, { maxTokens, model: chosen ?? status.model, thinking: status.thinking });
  const withFallbacks = status.fallbacks;
  const params = withFallbacks ? { ...request, betas: [FALLBACK_BETA], fallbacks: 'default' } : request;
  const api = client ?? new Anthropic({
    ...(env.ANTHROPIC_BASE_URL ? { baseURL: env.ANTHROPIC_BASE_URL } : {}),
    ...(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN || !env.ANTHROPIC_BASE_URL ? {} : { apiKey: 'local' }),
  });
  const start = performance.now();
  let response;
  try {
    response = withFallbacks ? await api.beta.messages.create(params) : await api.messages.create(params);
  } catch (error) {
    throw describe(error);
  }
  const text = response.content.filter(block => block.type === 'text').map(block => block.text).join('');
  const toolCalls = response.content.filter(block => block.type === 'tool_use').map(block => ({ id: block.id, name: block.name, arguments: block.input ?? {} }));
  const reasoning = response.content.filter(block => block.type === 'thinking' && block.thinking).map(block => block.thinking).join('\n') || null;
  const fallbacks = response.content.filter(block => block.type === 'fallback').map(block => `${block.from?.model} declined; ${block.to?.model} continued`);
  return {
    request: params,
    text,
    reasoning,
    tool_calls: toolCalls,
    model: response.model,
    stop_reason: response.stop_reason,
    stop_details: response.stop_reason === 'refusal' ? response.stop_details ?? null : null,
    usage: response.usage ? { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens } : null,
    fallbacks,
    durationMs: Math.round(performance.now() - start),
  };
}
