// The provider boundary: a cwa-messages/v1 payload in, a model's answer out, with the exact outbound request
// captured. Nothing here assembles or edits context; a refused assembly has no payload and never reaches this.
//
// Three providers, each configured from the environment and selectable in the inspector:
//   local      an OpenAI-compatible endpoint, such as Ollama, LM Studio, vLLM or llama.cpp
//              CWA_DEMO_LOCAL_BASE_URL (default http://localhost:11434/v1), CWA_DEMO_LOCAL_MODEL (default: the
//              first model the server lists), CWA_DEMO_LOCAL_API_KEY (optional)
//   anthropic  the Anthropic Messages API: ANTHROPIC_API_KEY or an `ant auth login` profile,
//              CWA_DEMO_ANTHROPIC_MODEL (default claude-opus-5), CWA_DEMO_ANTHROPIC_FALLBACKS=off to disable
//   openai     the OpenAI API: OPENAI_API_KEY, OPENAI_BASE_URL (default https://api.openai.com/v1),
//              CWA_DEMO_OPENAI_MODEL (default gpt-5)
// CWA_DEMO_PROVIDERS=off disables all three.
import * as anthropic from './anthropic.mjs';
import * as chat from './chat-completions.mjs';

export const LOCAL_BASE_URL = 'http://localhost:11434/v1';
export const OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const OPENAI_MODEL = 'gpt-5';

async function localStatus(env, options) {
  const base = { id: 'local', label: 'Local model', provider: 'openai-compatible', base_url: env.CWA_DEMO_LOCAL_BASE_URL || LOCAL_BASE_URL, model: env.CWA_DEMO_LOCAL_MODEL || null, fallbacks: false };
  if (base.model) return { ...base, configured: true, source: 'CWA_DEMO_LOCAL_MODEL' };
  const listed = await chat.listModels({ baseUrl: base.base_url, apiKey: env.CWA_DEMO_LOCAL_API_KEY, fetch: options.fetch });
  if (listed.models.length) return { ...base, model: listed.models[0], configured: true, source: `first of ${listed.models.length} models the server lists`, models: listed.models };
  return { ...base, configured: false, reason: listed.reason ?? `${base.base_url}/models lists no model: set CWA_DEMO_LOCAL_MODEL` };
}

function openaiStatus(env) {
  const base = { id: 'openai', label: 'OpenAI', provider: 'openai', base_url: env.OPENAI_BASE_URL || OPENAI_BASE_URL, model: env.CWA_DEMO_OPENAI_MODEL || OPENAI_MODEL, fallbacks: false };
  if (!env.OPENAI_API_KEY) return { ...base, configured: false, reason: 'set OPENAI_API_KEY' };
  return { ...base, configured: true, source: 'environment' };
}

function anthropicStatus(env) {
  return { id: 'anthropic', label: 'Anthropic', ...anthropic.providerStatus(env) };
}

export const PROVIDERS = ['local', 'anthropic', 'openai'];
const DESCRIBE = { local: localStatus, anthropic: anthropicStatus, openai: openaiStatus };

/** One provider: whether it can answer, its model, and why not when it cannot. Asking the local server for its
 * models is the one network call, bounded by a short timeout. */
export async function describeProvider(id, env = process.env, options = {}) {
  if (!DESCRIBE[id]) { const error = new Error(`unknown provider ${id}: use ${PROVIDERS.join(', ')}`); error.status = 400; throw error; }
  if (env.CWA_DEMO_PROVIDERS === 'off') return { id, label: id, provider: null, model: null, configured: false, reason: 'CWA_DEMO_PROVIDERS=off' };
  return DESCRIBE[id](env, options);
}

/** Every provider, in display order. */
export function describeProviders(env = process.env, options = {}) {
  return Promise.all(PROVIDERS.map(id => describeProvider(id, env, options)));
}

/** Send a cwa-messages/v1 payload to one provider. Resolves to {request, text, model, usage, ...}. */
export async function answer(payloadText, { provider, maxTokens, env = process.env, fetch: doFetch, client } = {}) {
  const status = await describeProvider(provider, env, { fetch: doFetch });
  if (!status.configured) { const error = new Error(`${status.label} is not configured: ${status.reason}`); error.status = 409; throw error; }
  const answered = status.id === 'anthropic'
    ? await anthropic.answer(payloadText, { maxTokens, model: status.model, client, env })
    : await chat.answer(payloadText, {
      baseUrl: status.base_url, model: status.model, maxTokens, fetch: doFetch,
      apiKey: status.id === 'openai' ? env.OPENAI_API_KEY : env.CWA_DEMO_LOCAL_API_KEY,
      maxTokensField: status.id === 'openai' ? 'max_completion_tokens' : 'max_tokens',
    });
  return { provider: status.id, label: status.label, ...answered };
}
