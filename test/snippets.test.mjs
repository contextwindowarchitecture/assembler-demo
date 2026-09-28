// The code snippets are the real request objects rendered as SDK calls: the TypeScript object literal is the request
// itself, and the Python parses (python3 checks it) and carries the same values with Python's literals.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { ROOT } from '../src/harness/adapters.mjs';
import { toRequest as anthropicRequest } from '../src/provider/anthropic.mjs';
import { toRequest as chatRequest } from '../src/provider/chat-completions.mjs';
import { snippets, toPython } from '../src/provider/snippets.mjs';

const payload = await readFile(path.join(ROOT, 'scenarios', 'basic', '03-authority', 'expected.messages.payload.txt'), 'utf8');
const python = source => spawnSync('python3', ['-c', 'import ast, sys; ast.parse(sys.stdin.read())'], { input: source, encoding: 'utf8' });

test('toPython writes JSON values as Python literals', () => {
  assert.equal(toPython({ a: [1, 'x\n"y"', true, null], b: { c: false } }), '{\n    "a": [\n        1,\n        "x\\n\\"y\\"",\n        True,\n        None,\n    ],\n    "b": {\n        "c": False,\n    },\n}');
  assert.equal(toPython([]), '[]');
  assert.equal(toPython({}), '{}');
});

test('the TypeScript snippets embed the exact request objects the providers send', () => {
  const out = snippets(payload, { maxTokens: 1200, anthropic: { model: 'claude-opus-5' }, openai: { model: 'gpt-5' } });
  const extract = (source, call) => JSON.parse(source.slice(source.indexOf(call) + call.length, source.lastIndexOf('});') + 1));
  assert.deepEqual(extract(out.anthropic.typescript, 'client.messages.create('), anthropicRequest(payload, { model: 'claude-opus-5', maxTokens: 1200 }));
  assert.deepEqual(extract(out.openai.typescript, 'client.chat.completions.create('), chatRequest(payload, { model: 'gpt-5', maxTokens: 1200, maxTokensField: 'max_completion_tokens' }));
  assert.match(out.anthropic.typescript, /^import Anthropic from "@anthropic-ai\/sdk";/);
  assert.match(out.openai.typescript, /^import OpenAI from "openai";/);
  assert.match(out.assemble.typescript, /import \{ assemble \} from "@contextwindowarchitecture\/assembler"/);
});

test('the Python snippets parse and carry the same request', () => {
  const out = snippets(payload, { maxTokens: 1200, anthropic: { model: 'claude-opus-5' }, openai: { model: 'gpt-5', reasoning_effort: 'low' } });
  for (const source of [out.assemble.python, out.anthropic.python, out.openai.python]) {
    const result = python(source);
    assert.equal(result.status, 0, `python3 rejects the snippet: ${result.stderr}`);
  }
  assert.match(out.anthropic.python, /max_tokens=1200,/);
  assert.match(out.anthropic.python, /thinking=\{\n {8}"type": "adaptive",/);
  assert.match(out.openai.python, /max_completion_tokens=1200,/);
  assert.match(out.openai.python, /reasoning_effort="low",/);
  assert.match(out.openai.python, /"role": "system",/);
});

test('a local endpoint shows in the client construction, and a compatible Anthropic server drops thinking', () => {
  const out = snippets(payload, { maxTokens: 400, anthropic: { model: 'gpt-oss', base_url: 'http://127.0.0.1:8000', thinking: false }, openai: { model: 'gpt-oss', base_url: 'http://127.0.0.1:8000/v1', maxTokensField: 'max_tokens' } });
  assert.match(out.openai.typescript, /new OpenAI\(\{ baseURL: "http:\/\/127\.0\.0\.1:8000\/v1"/);
  assert.match(out.openai.python, /OpenAI\(base_url="http:\/\/127\.0\.0\.1:8000\/v1"/);
  assert.match(out.openai.typescript, /"max_tokens": 400/);
  assert.match(out.anthropic.typescript, /new Anthropic\(\{ baseURL: "http:\/\/127\.0\.0\.1:8000" \}\)/);
  assert.equal(out.anthropic.typescript.includes('"thinking"'), false);
});
