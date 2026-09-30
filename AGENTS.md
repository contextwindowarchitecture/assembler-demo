# Working in cwa-demo-app

A demo application for the Context Window Architecture (CWA) draft specification. It runs a support-assistant scenario through the three conformant assemblers (Python, TypeScript, Go), compares their payloads and traces, and shows every decision in an inspector. It is not an assembler: it never decides what goes into a context window. It freezes inputs, hands them to an assembler, and shows what came back.

Read [docs/PLAN.md](docs/PLAN.md) for the three-stage plan and where the work stands, [docs/DESIGN.md](docs/DESIGN.md) for how the pieces fit, and [STYLE.md](STYLE.md) before touching the inspector's pages or stylesheet: it is the website's visual language applied here, and a test checks what it can.

## Rules

- **Test-first.** Red, then green, then refactor. Write the failing test, watch it fail for the reason you expect, then make it pass.
- **Commit unasked at each green step.** One behavior, or one refactor, per commit. Every commit passes `pnpm test`.
- **Conventional Commits, signed off.** `git commit -s` with a Conventional Commits subject (`feat:`, `fix:`, `test:`, `docs:`, `chore:`, `refactor:`, `build:`). Scopes: `harness`, `adapters`, `scenarios`, `inspector`, `provider`, `contract`, `docs`.
- **Never push.** The maintainer publishes commits.
- **Docs change in the same commit as the behavior.** A commit that changes behavior also updates the README, PLAN.md, DESIGN.md or the comments that describe it.
- **Prove a test protects something.** Before claiming it does, break the code on purpose and watch the test fail.
- Use Mermaid diagrams in docs wherever a flow or structure reads faster as a picture.

## What this app must never do

- **Never assemble.** No admission, fitting or rendering logic lives here. If a scenario needs a behavior the assemblers lack, the spec changes first (in the website repo), then the assemblers, then this app.
- **Never patch an assembler's output.** The harness compares what the adapters return, byte for byte for payloads and field for field for traces (minus `trace_id` and `timings`). A difference is a finding, not something to normalize away.
- **Never let a refusal reach a model.** The provider adapter takes a payload, and a refused assembly has none.
- **Never read the assemblers' source to decide an expectation.** Expectations come from a named assembler's run, are committed, and are reviewed by a person. `scenario.json` records which and whether.

## The contract is vendored

`vendor/cwa/` is a copy of the website repository's `schema/`, `contract/` and `conformance/`, pinned by SHA-256 in `vendor/cwa.lock.json`. Don't edit it here. Re-vendor from a committed website checkout with `pnpm run vendor ../website`, and commit the lock change as `build(contract): vendor website <short-sha>`.

## Commands

```sh
pnpm install                      # installs ajv and links ../cwa-assembler-ts
pnpm run setup                    # builds the Go adapter into bin/, checks the Python and TypeScript adapters
pnpm test                         # unit tests, scenario checks, and the harness against every available assembler
pnpm run conformance              # the vendored conformance cases through every adapter: the harness's self-check
pnpm run scenarios:build          # regenerate every stage's snapshots: the basic generator, then the intermediate producers
pnpm run producers:write          # run the intermediate producers (LlamaIndex etc., a uv project under producers/) and freeze the steps
pnpm run producers:check          # fail when a committed intermediate snapshot differs from what the producers build now
node src/harness/cli.mjs agent 01-investigate --reference                    # re-record a reference run of the advanced stage (real model)
node src/harness/cli.mjs agent 01-investigate --route incident-agent-reinforced --reference   # the same on the second route
node src/harness/cli.mjs replay reference-01-investigate                     # replay a recorded run through the assemblers
pnpm run expect --from python     # regenerate expected payloads and traces from the reference assembler
pnpm run compare                  # every scenario through every assembler, against expectations and each other
pnpm run inspector                # http://localhost:8787; loads .env (see .env.example) for the live-answer providers
pnpm run live                     # step 3 through the assemblers, then to every configured provider: real model answers on the terminal
pnpm run test:live                # the live path as a test (CWA_DEMO_LIVE=1); needs a running model
deploy/stage-context.sh /tmp/cwa-context                                     # the container build context: this repo and the three checkouts, nothing ignored
podman build -f /tmp/cwa-context/cwa-demo-app/Containerfile -t cwa-demo-app /tmp/cwa-context   # the image; see the Containerfile
deploy/openshift/deploy.sh        # to the current oc project: in-cluster build, or IMAGE=quay.io/<you>/cwa-demo-app for a podman build; .env becomes the Secret; ROUTE_HOST, ROUTE_PATH, STORAGE_CLASS, STORAGE_SIZE parametrize it
```

pnpm is the package manager: `packageManager` in package.json pins its version, and the TypeScript assembler is a `link:` dependency, so a rebuild in `../cwa-assembler-ts` reaches this app without a reinstall. Don't run `npm install` here: it writes its own lockfile and a different layout, and `test/toolchain.test.mjs` will say so.

The intermediate stage's producers are Python under `producers/`, run with `uv run --directory producers`; their data is under `scenarios/intermediate/source/`. A change to the corpus, a store or a producer means `pnpm run producers:write`, then `pnpm run expect --from python scenarios/intermediate`, and the tests will say so.

The advanced stage's MCP servers are under `mcp/servers/` and the controller under `src/agent/`. Reference runs are recorded against a real model and committed; live runs (`scenarios/advanced/runs/live-*`) are ignored. A change to the controller, the policy or the services means re-recording the reference runs with `--reference`, since the recorded snapshots carry the instructions and the grant.

The sibling checkouts are expected at `../cwa-assembler` (Python, with its `.venv` or `uv`), `../cwa-assembler-ts` (built: `dist/` present) and `../cwa-assembler-go`. `assemblers.json` names the adapter commands; override a path with the environment variables it documents.

`.env` is gitignored and holds provider settings and keys for one machine. Never commit it, never paste its values into a commit message, a document or a chat reply.
