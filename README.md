# cwa-demo-app

A support-assistant demo for the [Context Window Architecture](https://contextwindowarchitecture.io) (CWA) draft. One question, *What support does the Pro plan include?*, runs through the three conformant assemblers (Python, TypeScript, Go) on the same frozen inputs, and an inspector shows every decision on one screen:

> **Candidate context → CWA decisions → outbound request → model answer**

That view separates a producer error from an assembler error from an adapter error from a model error. The app never assembles anything itself: it freezes inputs, hands them to an assembler through the adapter protocol, compares what comes back byte for byte, and shows it.

The last mile is the code people already write. The live answers go through the official Anthropic SDK (`@anthropic-ai/sdk`) and the official OpenAI SDK (`openai`, which also reaches any OpenAI-compatible local server through a `baseURL`), and the inspector shows the assembled request as the literal `client.messages.create(...)` or `client.chat.completions.create(...)` call, in TypeScript and Python, copy-pasteable: the object in the call is the request the provider sends, built by the same code. Frameworks enter at the boundary where they sit in a real application, one per stage: retrieval and memory frameworks as producers in the intermediate stage, MCP and an agent harness in the advanced stage (see [docs/PLAN.md](docs/PLAN.md)).

## Quick start

```sh
npm install          # ajv, the Anthropic SDK, and a link to ../cwa-assembler-ts
npm run setup        # builds the Go adapter into bin/ and checks the Python and TypeScript adapters
npm test             # 64 tests: compare logic, scenario validity, the 74 vendored conformance snapshots through every adapter, the inspector API
npm run inspector    # http://localhost:8787
```

The sibling checkouts are expected at `../cwa-assembler` (Python, run through `uv`), `../cwa-assembler-ts` (built, so `dist/` exists) and `../cwa-assembler-go`. `assemblers.json` names each adapter command and the environment variable that overrides it.

For live answers, copy `.env.example` to `.env` and fill in a provider. A local model through any OpenAI-compatible server is the simplest:

```sh
CWA_DEMO_LOCAL_BASE_URL=http://127.0.0.1:8000/v1
CWA_DEMO_LOCAL_MODEL=gpt-oss-20b-MXFP4-Q8
CWA_DEMO_LOCAL_REASONING_EFFORT=low      # a reasoning model otherwise spends the route's reserved output thinking
```

The inspector loads `.env` at startup, and what the file says is what runs. Two commands prove the live path from a terminal, against the real model:

```sh
npm run live         # assemble step 3, send the payload to every configured provider, print each answer
npm run test:live    # the same as a test: an answer with text, not cut off, citing the Pro chunk
```

The test suite's only model is a mock under `test/helpers/`, used by one API test so `npm test` runs without a model; nothing in `src/` refers to it.

## The basic stage

Five steps, each adding to the last, so the audience watches one snapshot grow and the decisions change. [docs/SCENARIOS.md](docs/SCENARIOS.md) is the script.

| Step | What changes | Reason codes the trace shows |
| --- | --- | --- |
| 1 clean | Instructions, user state, three plan chunks, a memory, two prior turns, the query; a producer-reported expired memory | `expired` (producer stage) |
| 2 stale and foreign | An expired 2025 SLA that says Pro has phone support, another tenant's chunk, a chunk below the rerank threshold | `expired`, `out_of_scope`, `below_threshold` |
| 3 authority | A retrieval item addressed to `governance.instructions`, a chunk claiming `tier: protected`, a forum post that closes the evidence tag | `producer_slot_not_allowed`, `tier_upgrade_not_allowed`; the post is admitted and rendered escaped |
| 4 budget | `budget.input` lowered to 170 | state dropped, summaries substituted, prior turns and the Free chunk omitted: `over_budget` rows and `compressed` rows |
| 5 refusal | `budget.input` at 60, below the instructions and query alone | `protected_content_over_budget`: no payload, no model request |

Every step has two frozen renderings: `snapshot.json` (`fixture-xml/v1`, for the byte-exact comparison) and `snapshot.messages.json` (`cwa-messages/v1`, instructions in the system channel, for the model). Both are generated from `scenarios/basic/source/` and committed; expectations come from the Python reference and are marked unreviewed until a person has read them against the spec.

## The harness

```sh
npm run compare                     # every step, both renderings, every assembler: passed/failed vs expectation, and three-way agreement
npm run conformance                 # the vendored 52 cases and 22 rejections through every adapter: 52/52 and 22/22 for all three
npm run expect -- --from python     # regenerate expectations from one assembler
node src/harness/cli.mjs run scenarios/basic/04-budget/snapshot.json   # one snapshot, all assemblers, the payload printed
node src/harness/cli.mjs answer scenarios/basic/03-authority/snapshot.messages.json --provider local   # assemble, then ask a real model
```

Comparison follows `conformance/README.md`: payloads byte for byte; traces field for field without `trace_id` and `timings`; the JSON pointer of the first difference; an unsupported tokenizer or renderer is skipped, never passed. Three matching assemblers can share a mistake, so the committed expectation is the independent check.

## Layout

| Path | What it is |
| --- | --- |
| `adapters/` | The Python and TypeScript adapters (a dozen lines each); the Go one is `../cwa-assembler-go/cmd/adapter`, built into `bin/` |
| `assemblers.json` | Adapter commands, requirements and environment overrides |
| `scenarios/basic/source/` | The route policy, the two profiles, the clean fixture's batches, and each step's additions |
| `scenarios/basic/NN-step/` | Generated snapshots, `scenario.json`, and the expected payloads and traces |
| `src/harness/` | `adapters.mjs` (run and classify), `compare.mjs` (judge), `cases.mjs` (load), `schemas.mjs` (ajv), `cli.mjs` |
| `src/inspector/` | The server and the static page |
| `src/provider/` | `local` and `openai` through the OpenAI SDK, `anthropic` through the Anthropic SDK (or a compatible server), and `snippets.mjs`, the same requests as code |
| `vendor/cwa/` | The published contract, pinned by `vendor/cwa.lock.json` |
| `docs/` | [PLAN.md](docs/PLAN.md), [DESIGN.md](docs/DESIGN.md), [SCENARIOS.md](docs/SCENARIOS.md) |

See [AGENTS.md](AGENTS.md) for the working rules.

## License

Apache License 2.0, the same as the specification: see [LICENSE](LICENSE) and [NOTICE](NOTICE).
