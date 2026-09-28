// The assembled request as the code an application writes: the literal SDK call, in TypeScript and Python, built
// from the same request objects the providers send. The snippet is what goes to the model, not an illustration.
import { toRequest as anthropicRequest, DEFAULT_MODEL as ANTHROPIC_MODEL } from './anthropic.mjs';
import { toRequest as chatRequest } from './chat-completions.mjs';

/** A JSON value as a Python literal: dicts, lists, strings (JSON escapes are valid in Python), True/False/None. */
export function toPython(value, indent = 0, step = 4) {
  const pad = ' '.repeat(indent), inner = ' '.repeat(indent + step);
  if (value === null) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return `[\n${value.map(item => `${inner}${toPython(item, indent + step, step)}`).join(',\n')},\n${pad}]`;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) return '{}';
  return `{\n${entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${toPython(item, indent + step, step)}`).join(',\n')},\n${pad}}`;
}

/** The members of an object as Python keyword arguments, one per line. */
function kwargs(object, indent = 4) {
  const pad = ' '.repeat(indent);
  return Object.entries(object).map(([key, value]) => `${pad}${key}=${toPython(value, indent)},`).join('\n');
}

/** The members of an object as a TypeScript object literal body (JSON is valid TypeScript). */
function tsObject(object) {
  return JSON.stringify(object, null, 2).split('\n').map((line, index) => (index === 0 ? line : `${line}`)).join('\n');
}

const HEADER = `// The payload is the assembler's cwa-messages/v1 output. The request below maps it to the platform's roles (R-7):
// system entries become system text, tool entries become tools, and the one user message is sent as is.
// Nothing is added, and a refused assembly has no payload, so it never becomes a request.`;
const PY_HEADER = HEADER.replace(/^\/\/ /gm, '# ');

/**
 * Snippets for one cwa-messages/v1 payload: how to get the payload (assemble), then the literal SDK calls.
 * `openai.base_url` selects the endpoint the OpenAI snippet shows: the OpenAI API, or a local OpenAI-compatible server.
 */
function openaiSnippets(payloadText, maxTokens, config) {
  const request = chatRequest(payloadText, { model: config.model ?? 'gpt-5', maxTokens, maxTokensField: config.maxTokensField ?? 'max_completion_tokens', extra: config.reasoning_effort ? { reasoning_effort: config.reasoning_effort } : {} });
  const clientTs = config.base_url ? `new OpenAI({ baseURL: ${JSON.stringify(config.base_url)}, apiKey: process.env.LOCAL_API_KEY ?? "local" })` : 'new OpenAI()';
  const clientPy = config.base_url ? `OpenAI(base_url=${JSON.stringify(config.base_url)}, api_key=os.environ.get("LOCAL_API_KEY", "local"))` : 'OpenAI()';
  return {
    typescript: `import OpenAI from "openai";

const client = ${clientTs};
${HEADER}
const completion = await client.chat.completions.create(${tsObject(request)});
const text = completion.choices[0].message.content;`,
    python: `import os
from openai import OpenAI

client = ${clientPy}
${PY_HEADER}
completion = client.chat.completions.create(
${kwargs(request)}
)
text = completion.choices[0].message.content`,
  };
}

export function snippets(payloadText, { maxTokens = 4096, anthropic = {}, openai = {}, local } = {}) {
  const anthropicReq = anthropicRequest(payloadText, { model: anthropic.model ?? ANTHROPIC_MODEL, maxTokens, thinking: anthropic.thinking ?? true });
  const anthropicClientTs = anthropic.base_url ? `new Anthropic({ baseURL: ${JSON.stringify(anthropic.base_url)} })` : 'new Anthropic()';
  const anthropicClientPy = anthropic.base_url ? `anthropic.Anthropic(base_url=${JSON.stringify(anthropic.base_url)})` : 'anthropic.Anthropic()';
  return {
    ...(local ? { local: openaiSnippets(payloadText, maxTokens, { maxTokensField: 'max_tokens', ...local }) } : {}),
    assemble: {
      typescript: `import { assemble } from "@contextwindowarchitecture/assembler";

// snapshot: the frozen input (snapshot.schema.json): batches from your producers, the route policy,
// the profile, the budget, the tokenizer and renderer ids, and the clock. Nothing else reaches assembly.
const { payload, trace } = assemble(snapshot);
if (payload === null) {
  // Refused: no payload, and trace.refused.reason says why (R-17). Recover in the application, never by sending less.
  throw new Error(\`assembly refused: \${trace.refused.reason}\`);
}
const ir = JSON.parse(new TextDecoder().decode(payload)); // cwa-messages/v1: { system, tools, messages }
// trace.context.snapshot_digest and trace.result.hash identify this exact request for replay.`,
      python: `from cwa import Snapshot, assemble

# snapshot: the frozen input (snapshot.schema.json): batches from your producers, the route policy,
# the profile, the budget, the tokenizer and renderer ids, and the clock. Nothing else reaches assembly.
result = assemble(Snapshot.from_json(snapshot))
if result.payload is None:
    # Refused: no payload, and the trace says why (R-17). Recover in the application, never by sending less.
    raise RuntimeError(f"assembly refused: {result.trace['refused']['reason']}")
ir = json.loads(result.payload)  # cwa-messages/v1: {"system": [...], "tools": [...], "messages": [...]}
# result.trace["context"]["snapshot_digest"] and result.trace["result"]["hash"] identify this exact request for replay.`,
    },
    anthropic: {
      typescript: `import Anthropic from "@anthropic-ai/sdk";

const client = ${anthropicClientTs};
${HEADER}
const response = await client.messages.create(${tsObject(anthropicReq)});
const text = response.content.filter(block => block.type === "text").map(block => block.text).join("");`,
      python: `import anthropic

client = ${anthropicClientPy}
${PY_HEADER}
response = client.messages.create(
${kwargs(anthropicReq)}
)
text = "".join(block.text for block in response.content if block.type == "text")`,
    },
    openai: openaiSnippets(payloadText, maxTokens, openai),
  };
}
