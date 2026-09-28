// Real models, on purpose: every provider .env configures gets the step 3 request and must answer. Off unless
// CWA_DEMO_LIVE=1 (pnpm run test:live), since it needs a running model and is as fast as the model is. What it asserts
// is what the demo needs: an answer with text, not cut off, and the citation the instructions demand.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { loadDotEnv } from '../src/env.mjs';
import { loadAssemblers, ROOT, runAll, select } from '../src/harness/adapters.mjs';
import { answer, describeProviders } from '../src/provider/index.mjs';

const live = process.env.CWA_DEMO_LIVE === '1';
if (live) loadDotEnv();
const providers = live ? await describeProviders() : [];
const configured = providers.filter(p => p.configured);

test('a provider is configured', { skip: live ? false : 'set CWA_DEMO_LIVE=1 to call real models' }, () => {
  assert.ok(configured.length > 0, `none configured: ${providers.map(p => `${p.id}: ${p.reason}`).join('; ')}`);
});

for (const provider of configured) {
  test(`${provider.label} (${provider.model}) answers the step 3 request from the evidence`, { timeout: 180_000 }, async () => {
    const file = path.join(ROOT, 'scenarios', 'basic', '03-authority', 'snapshot.messages.json');
    const bytes = await readFile(file);
    const assemblers = select(await loadAssemblers(), []);
    const [result] = await runAll({ [Object.keys(assemblers)[0]]: Object.values(assemblers)[0] }, bytes);
    assert.equal(result.outcome, 'assembled');
    const reply = await answer(result.payload.toString('utf8'), { provider: provider.id, maxTokens: JSON.parse(bytes.toString('utf8')).budget.reserved_output });
    assert.ok(reply.text.trim().length > 0, `no answer text (stop ${reply.stop_reason}${reply.reasoning ? `; reasoning: ${reply.reasoning.slice(0, 120)}` : ''})`);
    assert.ok(!['length', 'max_tokens'].includes(reply.stop_reason), `the answer was cut off by the reserved output (stop ${reply.stop_reason})`);
    // Models sometimes typeset the id with a Unicode hyphen (U+2010 to U+2015); the citation still names the chunk.
    assert.match(reply.text.replace(/[\u2010-\u2015]/g, '-'), /kb:support-plans:v7#pro/, `the instructions ask for the evidence id in brackets; got: ${reply.text.slice(0, 200)}`);
    console.log(`  ${provider.label}: ${reply.model}, ${reply.durationMs} ms, ${reply.usage?.output_tokens ?? '?'} output tokens`);
  });
}
