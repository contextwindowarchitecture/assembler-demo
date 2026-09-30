# cwa-demo-app

A support-assistant demo for the [Context Window Architecture](https://contextwindowarchitecture.io) (CWA) draft. One question, *What support does the Pro plan include?*, runs through the three conformant assemblers (Python, TypeScript, Go) on the same frozen inputs, and an inspector shows every decision on one screen:

> **Candidate context → CWA decisions → outbound request → model answer**

That view separates a producer error from an assembler error from an adapter error from a model error. The app never assembles anything itself: it freezes inputs, hands them to an assembler through the adapter protocol, compares what comes back byte for byte, and shows it.

The last mile is the code people already write. The live answers go through the official Anthropic SDK (`@anthropic-ai/sdk`) and the official OpenAI SDK (`openai`, which also reaches any OpenAI-compatible local server through a `baseURL`), and the inspector shows the assembled request as the literal `client.messages.create(...)` or `client.chat.completions.create(...)` call, in TypeScript and Python, copy-pasteable: the object in the call is the request the provider sends, built by the same code. Frameworks enter at the boundary where they sit in a real application, one per stage: retrieval and memory frameworks as producers in the intermediate stage, MCP and an agent harness in the advanced stage (see [docs/PLAN.md](docs/PLAN.md)).

## Quick start

The project uses pnpm, pinned by `packageManager` in package.json. Install it once with `npm install -g pnpm`, or run `corepack enable` on a Node that bundles corepack and it fetches the pinned version on first use. Running `npm install` here stops on the `link:` dependency rather than leaving a mixed tree.

```sh
pnpm install          # ajv, the Anthropic SDK, and a link to ../cwa-assembler-ts
pnpm run setup        # builds the Go adapter into bin/ and checks the Python and TypeScript adapters
pnpm test             # 64 tests: compare logic, scenario validity, the 74 vendored conformance snapshots through every adapter, the inspector API
pnpm run inspector    # http://localhost:8787
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
pnpm run live         # assemble step 3, send the payload to every configured provider, print each answer
pnpm run test:live    # the same as a test: an answer with text, not cut off, citing the Pro chunk
```

The test suite's only model is a mock under `test/helpers/`, used by one API test so `pnpm test` runs without a model; nothing in `src/` refers to it.

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

## The intermediate stage

*Given my account and our previous conversation, what support am I entitled to?* Several sources compete for a limited budget, and the producers are real: a **LlamaIndex** pipeline over 31 support documents in a shared index (`nodes → BM25Retriever → NearDuplicatePostprocessor → CWA batch`), an account database, a memory store, and the conversation with a supplied summary per turn. They live in `producers/`, a `uv` project, and run before assembly; `producers.freeze` composes their batches, the declared conflict groups, the route policy and the profile into each step's frozen snapshots. The page at `/intermediate/` shows how each producer ran and can run them **live** or **replay** the frozen batches; a live run reproduces the frozen digest, and the badge says so. [docs/SCENARIOS.md](docs/SCENARIOS.md) has the script.

| Step | What happens | Reason codes the trace shows |
| --- | --- | --- |
| 1 retrieval | The current Pro paragraph, its word-for-word copy in the onboarding guide, its near-copy on the support-hours page, and the expired 2025 edition | `duplicate_content` (producer stage for the near-copy, assembler stage for the copy), `expired` |
| 2 overlap | Ten hits: three chunks of the same document, a Globex document from the shared index | `source_diversity_cap`, `out_of_scope` |
| 3 memory | An expired memory suppressed and reported by the producer; another user's memory leaked by it | `expired`, `out_of_scope` |
| 4 conflict | Account state says Pro, a memory says Free: a declared fact group the route's precedence decides; two citation instructions surfaced as conflicting | `conflict_lost`; `g-cite` surfaced in the payload |
| 5 summary | `budget.input` at 330: every prior turn and three evidence chunks take their supplied summaries; state.user is protected by the route | `compressed` rows |
| 6 evidence required | An off-topic question: nothing scores above the threshold, the route requires evidence | `below_threshold`, `evidence_required` with recovery `request_context` |

```sh
pnpm run producers:write      # run the producers and freeze every intermediate step
pnpm run producers:check      # fail when a committed snapshot differs from what the producers build now
```

## The advanced stage

*Check my current support entitlement, investigate the incident in my region, and draft the next action.* Context evolves through a bounded tool loop, and the pieces are real: three **MCP** servers (the official SDK, stdio) over local services propose tools; the application's **capability policy** grants three of them and never offers `close_ticket`; the **guard** authorizes every request the model makes, against the grant, the tool's schema and a scope rule, before any call; each observation enters the next inference as `evidence.tool_results`, and the route keeps the latest observation of a call. The model's earlier turns are history inside the one user message. The controller bounds turns and recoveries and records every inference. Reference runs recorded against a local gpt-oss-20b are committed and replay through all three assemblers.

| Run | What happens |
| --- | --- |
| `reference-01-investigate` | account checked; a request for a colleague's account **denied** by the guard and reported to the model as task state; status checked, then re-checked, the later observation superseding the first; an answer in the output contract that says what could not be checked |
| `reference-02-timeout` | the status server times out three times; each failure is an observation and task state; the eventual success supersedes them; the answer names the gap |
| `reference-01-investigate-reinforced` | the same scenario on the **second route**: a different placement profile (instructions restated before the query, evidence and observations ahead of state), a tighter budget under which the evidence chunks take their summaries, and the model reached through the Anthropic-style endpoint, so the outbound request is a Messages API request |

Two routes, two profiles, the same tools and guard: `scenarios/advanced/source/routes.json` names each route's policy, profiles, provider and budget, and the page shows them side by side. Different profiles produce different requests; the pass criteria hold on both.

```sh
node src/harness/cli.mjs agent 01-investigate --provider local      # run the loop against a real model and record it
node src/harness/cli.mjs replay reference-01-investigate            # every recorded inference through the assemblers
```

## The harness

```sh
pnpm run compare                     # every step, both renderings, every assembler: passed/failed vs expectation, and three-way agreement
pnpm run conformance                 # the vendored 52 cases and 22 rejections through every adapter: 52/52 and 22/22 for all three
pnpm run expect --from python        # regenerate expectations from one assembler
node src/harness/cli.mjs run scenarios/basic/04-budget/snapshot.json   # one snapshot, all assemblers, the payload printed
node src/harness/cli.mjs answer scenarios/basic/03-authority/snapshot.messages.json --provider local   # assemble, then ask a real model
```

Comparison follows `conformance/README.md`: payloads byte for byte; traces field for field without `trace_id` and `timings`; the JSON pointer of the first difference; an unsupported tokenizer or renderer is skipped, never passed. Three matching assemblers can share a mistake, so the committed expectation is the independent check.

## In a container

`Containerfile` builds one image with the inspector and the three assemblers. The build context is not this repository alone, since the assemblers are sibling checkouts: `deploy/stage-context.sh` lays the four working trees out side by side, each as git lists it (tracked and untracked files, nothing ignored, never `.env`), and the image is built from that. Inside, the four keep the same layout under `/opt/cwa`, so `assemblers.json` holds as it does here.

```sh
deploy/stage-context.sh /tmp/cwa-context
podman build -f /tmp/cwa-context/cwa-demo-app/Containerfile -t cwa-demo-app /tmp/cwa-context
podman run --rm -p 8787:8787 --env-file .env cwa-demo-app     # http://localhost:8787, providers from .env
```

The image starts the inspector with `--host 0.0.0.0` (it listens on loopback otherwise) and reads the provider settings from the environment; a model URL must be reachable from the container, so a server on this machine's `localhost` is not. The inspector has no login: whoever reaches it can run the assemblers and, with a provider configured, spend its tokens.

## Layout

| Path | What it is |
| --- | --- |
| `adapters/` | The Python and TypeScript adapters (a dozen lines each); the Go one is `../cwa-assembler-go/cmd/adapter`, built into `bin/` |
| `assemblers.json` | Adapter commands, requirements and environment overrides |
| `scenarios/basic/source/` | The route policy, the two profiles, the clean fixture's batches, and each step's additions |
| `scenarios/basic/NN-step/` | Generated snapshots, `scenario.json`, and the expected payloads and traces |
| `scenarios/intermediate/source/` | The corpus (markdown with front matter), the account, memory and history stores, the summaries, the route policy, the profiles and the step specs |
| `producers/` | The intermediate stage's producers, a `uv` project: the LlamaIndex retrieval pipeline, the other producers, `freeze`, and `retrieve` for the agent |
| `mcp/servers/` | The advanced stage's MCP servers over `scenarios/advanced/source/services/`, with fault injection |
| `src/agent/` | The controller, the capability policy, the guard, the MCP client, the agent's producers and the run store |
| `scenarios/advanced/` | The stage's source (services, capability policy, route, profiles, instructions, scenarios) and the recorded reference runs |
| `src/harness/` | `adapters.mjs` (run and classify), `compare.mjs` (judge), `cases.mjs` (load), `schemas.mjs` (ajv), `producers.mjs` (run the producers live), `cli.mjs` |
| `src/inspector/` | The server; `public/` holds the landing page, a page per stage and the shared columns |
| `src/provider/` | `local` and `openai` through the OpenAI SDK, `anthropic` through the Anthropic SDK (or a compatible server), and `snippets.mjs`, the same requests as code |
| `vendor/cwa/` | The published contract, pinned by `vendor/cwa.lock.json` |
| `Containerfile`, `deploy/` | The image (inspector and three assemblers), `stage-context.sh` for its build context, and the OpenShift deployment |
| `docs/` | [PLAN.md](docs/PLAN.md), [DESIGN.md](docs/DESIGN.md), [SCENARIOS.md](docs/SCENARIOS.md) |

See [AGENTS.md](AGENTS.md) for the working rules.

## License

Apache License 2.0, the same as the specification: see [LICENSE](LICENSE) and [NOTICE](NOTICE).
