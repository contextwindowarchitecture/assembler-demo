# The basic stage, as a script

Five steps, one question, about twelve minutes. Each step adds to the last: the audience watches one snapshot grow and the decisions change. What to click, what to say, what to point at, and what to ask.

## Before the talk

- Start the local model server and check it lists the model: `curl -H "Authorization: Bearer $KEY" http://127.0.0.1:8000/v1/models`.
- `.env` names the provider (see `.env.example`). `npm run inspector`, open `http://localhost:8787` at full width (the four columns need about 1400 px), and pick the OS theme the projector reads best; the page follows it.
- `npm test` once. It runs the 74 published conformance snapshots through all three assemblers, so if it is green the harness can be trusted on stage.
- Have a terminal ready with `npm run compare` for the closing.
- Arrow keys switch steps. The budget field reassembles live. The `frozen` button returns to the committed snapshot.

The screen, left to right: **Candidate context** (what the producers sent, colored by outcome) → **CWA decisions** (the trace) → **Outbound request** (the payload, or "no model request") → **Model answer** (a live call, with the exact request beside it).

## Step 1: assemble a clean fixture

**Click:** step 1, rendering `fixture-xml/v1`, assembler `all three`.

**Say:** One support question, *What support does the Pro plan include?* Five producers ran before assembly: a policy registry, an account-state service, a knowledge-base search, a memory store and the conversation. Each handed over a batch of candidate items. Nothing decided anything yet.

**Point at:** the badges. *3 assemblers agree*: Python, TypeScript and Go produced the same bytes and the same trace. *matches expectation*: the committed expectation for this step, generated from the reference and awaiting review.

**Point at:** the decisions. Nine items included in placement order, each with its token count. One exclusion already: the memory producer reported an expired memory *without sending its body*. That row travelled into the trace as the producer wrote it.

**Point at:** the context block at the bottom of the decisions: the snapshot digest and the payload hash. Replay this snapshot anywhere and you get these bytes.

**Ask:** where would you look, today, to know exactly what your model was sent?

## Step 2: add an expired document and another tenant's

**Click:** step 2.

**Say:** Now the retriever also returns three things it should not have: a 2025 SLA whose `expires` has passed, and which says Pro includes phone support; a chunk from tenant `globex` that leaked through a shared index; and a refunds chunk that scored 0.41 against the route's threshold of 0.6.

**Point at:** the three red cards in the candidates column, each with its reason code, and the *Reason codes in this assembly* list under the decisions, which quotes the published registry text for each. `expired` (R-9), `out_of_scope` (R-2), `below_threshold` (R-13).

**Say:** Eligibility is the route's predicate, versioned and applied outside the model. The stale SLA never reaches the request, so the model cannot repeat it. And when an item fails several checks, the trace records the earliest applicable code, in the registry's order, so three implementations record the same one.

**Ask:** without this, whose job was it to notice the 2025 document?

## Step 3: add a retrieval item that claims a governance slot

**Click:** step 3.

**Say:** Three more from the retriever. An agent note addressed to `governance.instructions`, with governing authority and verified trust, that says to tell customers Pro includes phone support. An overview chunk that declares itself protected. And a forum post whose body closes the evidence tag and opens a system tag.

**Point at:** `producer_slot_not_allowed` on the agent note. A retrieval producer's kind bounds its slots whatever the route lists and whatever the item says about itself. `tier_upgrade_not_allowed` on the overview: only the route's versioned policy raises a tier.

**Click:** rendering `cwa-messages/v1`.

**Point at:** the outbound request. The instructions are in the system channel; everything else, the prior turns included, is inside the one user message as a transcript. The forum post is there, admitted as evidence, with its `</evidence>` and `<system>` escaped. Injected markup is material, never structure.

**Point at:** *Use it in your code*, under the request. Switch between TypeScript and Python, and between the Anthropic SDK and the OpenAI SDK. The object in the call is this request: the assembler's payload is all an application needs, and the rest is the `create` call it already writes. The *Assemble* tab shows the three lines before it, with the refusal branch.

**Click:** *Send to all* in the answer column. While it runs, say that the request shown is the request sent, through the official SDKs, and that the model's answer is a separate evaluation from the assembler's correctness.

**Point at:** the answers, one per provider, each with the exact request under it. Look for the citation of `kb:support-plans:v7#pro` and for the absence of phone support.

**Ask:** what proved the model was not told to promise phone support? Not the answer: the trace.

## Step 4: lower the budget until optional content is omitted

**Click:** step 4 (budget 170, down from 600).

**Say:** Same candidates, a third of the budget. Nothing was truncated. Droppable content went first: the user's state. Then the route's fitting order reduced compressible items: the Enterprise and Pro chunks took the summaries their producer supplied, both prior turns were omitted, since this route sheds history before evidence, and the lowest-ranked chunk, Free, was omitted.

**Point at:** the *Compressed* table (from → to, the variant id) and the four `over_budget` rows. Every reduction is a trace row.

**Optional, live:** type `120` into `budget.input`. The header says *derived snapshot*, the badge says *no expectation*, and the decisions change. Type `600`, or click *frozen*, to come back.

**Ask:** which of these decisions would you have wanted the model to make for you?

## Step 5: lower it further until protected content cannot fit

**Click:** step 5 (budget 60).

**Say:** Below what the instructions and the query need on their own. The assembler refuses: `protected_content_over_budget`. No payload, `result: null`, nothing included, and every admission decision still in the trace.

**Point at:** the *No model request* panel, and the answer column: nothing to send.

**Say:** Protected content is never truncated, and a refusal never becomes a request. The application gets a reason and decides what to do: raise the budget, narrow retrieval, or stop.

## Closing

**Run:** `npm run compare` in the terminal. Ten rows, one per step and rendering, three assemblers, all `passed`, all `agree`.

**Say:** Three implementations, three languages, same frozen input, same bytes out. The expectation they are compared with is generated from one of them and reviewed by a person, because three matching assemblers can share a mistake. What the model then does with those bytes is evaluated separately, and that is the next stage: competing sources under a constrained budget, then a tool loop.

# The intermediate stage, as a script

Six steps, one question, about fifteen minutes. The page is `/intermediate/`. Start in **replay**; switch to **live** once, on step 1, to show that running the producers now gives the same digest.

**Say, before step 1:** The basic stage used fixtures. This stage's inputs are produced: a LlamaIndex pipeline over thirty-one support documents, an account database, a memory store, and the conversation. Each hands the assembler a batch. The producers strip shows how each ran. The question is *Given my account and our previous conversation, what support am I entitled to?*

## Step 1: retrieve current, outdated, and a copy

**Point at:** the kb-search card: the pipeline (nodes, BM25, near-duplicate postprocessor, CWA batch) and the four retrieved chunks with their scores. The retrieval query is the application's, phrased in the corpus vocabulary, not the user's sentence.

**Point at:** the candidates. The Pro paragraph is included. Its word-for-word copy in the onboarding guide is excluded by the assembler as `duplicate_content`, because the route asks for exact deduplication. Its near-copy on the support-hours page never reached the assembler: the retriever dropped it and reported it with the chunk it kept. The 2025 edition is `expired`.

**Say:** Near-duplicates are the retriever's job; exact duplicates the assembler's. Both leave a row.

**Click:** Producers → *run live now*. Wait for the badge: **live = replay**. **Say:** the producers ran just now, and the snapshot they built has the digest of the frozen one. Switch back to replay.

## Step 2: widen retrieval

**Point at:** ten hits now. Three chunks of the same document; the route keeps two per source, so the Free chunk is `source_diversity_cap`. A Globex document came out of the shared index and is `out_of_scope`.

**Ask:** would you rather have written this as a retriever heuristic, or as one line of versioned route policy?

## Step 3: memory

**Point at:** the memory-svc card: one item reported excluded. The producer suppressed an expired memory and sent its id and reason, never its body. It also filters by tenant only, so another user's memory reached the assembler, which excluded it as `out_of_scope`.

**Say:** the producer did half its job; admission did the rest. Both are in the trace.

## Step 4: conflict

**Point at:** the plan memory, now `conflict_lost`. The account says Pro; the memory from August says Free. The application declared a fact group on `plan`; the route's precedence puts the state service first. Nobody read the prose.

**Point at:** the conflicts table: `g-plan` resolved by policy, winner the account row; `g-cite` escalated and surfaced. Switch the rendering to messages: both citation instructions are in the system channel marked with the group id.

**Say:** an unresolved conflict is never dropped silently; the route says surface, request context or refuse.

## Step 5: summaries

**Point at:** the compressed table: four prior turns and three evidence chunks, each with the variant id that replaced it. Nothing omitted; the plan is protected by the route this time.

**Say:** the summaries were written before the snapshot froze. Assembly never calls a model.

**Click:** *Send to all* with the messages rendering, if the room has a model. The answer should cite the Pro paragraph and mention the Sydney engineer's night-time question from the summarised history.

## Step 6: evidence required

**Point at:** the refusal: `evidence_required`, recovery `request_context`. Every retrieved chunk is `below_threshold`. No request. **Say:** never answer from nothing; the route decided that, and the application gets told what to do next.

## Closing

`npm run compare` shows both stages: twenty-two rows, three assemblers, all passed, all agree.

## If something goes wrong

| Symptom | Do |
| --- | --- |
| A provider shows *not configured* | click *re-check* after starting the server; the reason names the variable to set |
| The answer column says a request failed | the message quotes the server: usually the model name or the key; fix `.env` and restart `npm run inspector` |
| An assembler shows *not built* | `npm run setup` |
| The badge says *DISAGREE* | that is a finding, not a demo bug: hover the badge for the first difference, and run `node src/harness/cli.mjs run <snapshot> --json` |
| The page is empty | the server prints the URL it listens on; check `PORT` |
| Live mode says the producers are not present, or errors | `producers/pyproject.toml` must exist and `uv` must be on the path; the first live run installs the environment, which takes a moment |
| Live ≠ replay | the corpus or a store changed since the step was frozen: `npm run producers:write`, then `npm run expect -- --from python scenarios/intermediate` |
