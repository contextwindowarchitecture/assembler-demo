**Build one support-assistant demo in three stages: deterministic assembly, competing context sources, then a stateful tool loop.** Run every stage through the same comparison harness for TypeScript, Python, and Go.

Your assumption is partly right: the context-engineering tools in your document supply useful inputs, but **CWA’s demonstration should center on the decisions between those inputs and the model request**.

Two pitfalls matter:

- Adding several frameworks immediately makes failures difficult to isolate.
- A convincing model answer does not prove assembler correctness; three matching assemblers can also share the same mistake.

Think of the assemblers as three compilers: feed them the same frozen input, compare their output against an independently reviewed expectation, then evaluate what the model does with that output.

I treated your documents as background material. The details below also follow your local [conformance guide](/Users/mhillsma/Development/misc/cwa/cwa-spec-only/conformance/README.md). These are proposed setups, not claims that I have verified each assembler’s implementation.

| Level | Main question demonstrated | Setup |
|---|---|---|
| Basic | What gets admitted, excluded, and rendered? | Local fixtures, assembler, payload/trace viewer |
| Intermediate | What survives when useful sources compete? | Retrieval, account state, memory, history, constrained budget |
| Advanced | How does context change across tool calls and recovery? | Bounded agent loop, tool authorization, checkpoints, replay |

The Mermaid source below uses `text` fences so it remains copyable without automatic diagram rendering.

**1. Basic — “Show me exactly what CWA assembled”**

Use a single question: **“What support does the Pro plan include?”**

Create a small fixture containing application instructions, the user query, current support documentation, and deliberately problematic candidates. No retrieval service is necessary.

```text
flowchart TD
    Q["User question"] --> S["Frozen assembly snapshot"]
    F["Local fixture producers<br/>Instructions and support documents"] --> S
    P["Pinned route policy and placement profile<br/>Clock, scope, tokenizer and budget"] --> S

    S --> A["Selected CWA assembler<br/>TypeScript, Python or Go"]

    A --> O{"Assembly outcome"}
    O -->|Success| R["Rendered payload"]
    O -->|Refusal| N["No model request"]
    A --> T["Assembly trace"]

    R --> V["Demo inspector<br/>Candidates, decisions and final payload"]
    T --> V
    N --> V

    R -. Optional live call .-> L["Provider adapter and LLM"]
    L --> Y["Answer"]
```

**Demonstration sequence:**

1. Assemble a clean fixture.
2. Add an expired document and an item belonging to another tenant.
3. Add a retrieval item attempting to claim a governance slot.
4. Lower the budget until optional content is omitted.
5. Lower it further until protected content cannot fit.

The inspector should make every change visible: candidate ID, source, intended slot, admission decision, exclusion reason, placement, and token usage.

**Pass criteria:** expected payload bytes and trace match; protected content remains intact or assembly refuses; refusal never reaches the model.

For initial portability tests, use your declared fixture tokenizer and renderer. A fixture tokenizer is not a production model tokenizer.

**What this proves:** admission, authority boundaries, budgeting, rendering, and reproducibility. It does not prove that the model is immune to prompt injection.

---

**2. Intermediate — “Several sources compete for a limited context budget”**

Extend the question to: **“Given my account and our previous conversation, what support am I entitled to?”**

Use approximately 30 short support documents, a small account database, saved conversation history, and a few memories with explicit scope and expiry.

For a concrete integration, use **LlamaIndex for retrieval and postprocessing**, then convert its output into CWA producer batches. Its postprocessor interface sits between retrieval and response synthesis, making it a suitable integration point. Keep CWA responsible for the final assembly. [LlamaIndex documentation](https://developers.llamaindex.ai/python/framework/module_guides/querying/node_postprocessors/)

```text
flowchart TD
    D["Support documents"] --> R["Retrieve and rerank"]
    Q["User question"] --> R

    R --> E["Evidence producer adapter"]
    DB["Account database"] --> U["State producer adapter"]
    M["Scoped memory store"] --> MA["Memory producer adapter"]
    H["Conversation history"] --> HA["History and summary producer"]

    E --> S["Freeze producer batches<br/>Include supplied compression variants"]
    U --> S
    MA --> S
    HA --> S
    Q --> S
    P["Application instructions<br/>Route policy, profile and declared conflicts"] --> S

    S --> A["Selected CWA assembler<br/>Admission, conflict policy, fitting and rendering"]

    A --> T["Trace and context inspector"]
    A --> O{"Assembly outcome"}
    O -->|Success| L["Provider adapter and LLM"]
    O -->|Refusal| X["Show reason and recovery action"]
    L --> Y["Answer with source references"]
```

**Demonstration sequence:**

- Retrieve current and outdated documentation.
- Include overlapping chunks to exercise deduplication and source diversity.
- Add an expired memory.
- Supply account state that disagrees with a remembered plan.
- Reduce the budget to show a supplied summary replacing longer content.
- Remove usable evidence and demonstrate the route’s required-evidence behavior.

Two boundaries are important for troubleshooting:

- **Declare factual conflicts upstream.** The assembler applies conflict policy to declared groups; it does not discover contradictions by reading arbitrary prose.
- **Generate summaries before freezing the snapshot.** The assembler selects supplied variants. Repeated live summarization would change the input and obscure assembly differences.

Keep a captured retrieval result so you can switch between **live production of context** and **replay of the same context**.

**Pass criteria:** all implementations make the expected admission, conflict, compression, and omission decisions on the frozen snapshot. Separately check whether the answer is supported by the retained evidence.

**What this proves:** CWA can coordinate independent context producers while preserving an explanation of what survived and why.

---

**3. Advanced — “Context evolves through a controlled tool loop”**

Extend the scenario: **“Check my current support entitlement, investigate this incident, and draft the next action.”**

Add two or three tools, such as account lookup, service-status lookup, and ticket-history lookup. Start with local mock services so you can deliberately inject failures.

MCP is a suitable interface for exposing tools and contextual resources; your application still owns orchestration and authorization. [MCP architecture](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture)

```text
flowchart TD
    Q["User request"] --> C["Application controller<br/>Bounded turns and recovery attempts"]

    C --> P["Collect current context<br/>Retrieval, state, memory and history"]
    CP["Capability policy<br/>Approved tool definitions"] --> S
    RP["Pinned route policy and profile"] --> S
    P --> S["Freeze snapshot for this inference"]

    S --> A["Selected CWA assembler"]
    A --> O{"Assembly outcome"}

    O -->|Success| W["Provider adapter<br/>Capture outbound request"]
    W --> L["LLM"]
    L --> D{"Answer or tool request"}

    D -->|Answer| V["Validate output and evidence"]
    V --> Y["Final answer or ticket draft"]

    D -->|Tool request| G["Application authorization<br/>Validate tool, arguments and scope"]
    G --> T["Execute approved MCP or API tool"]
    T --> E["Tool-result producer<br/>Attach provenance and observation time"]
    E --> C

    O -->|Refusal| R["Application recovery policy<br/>Narrow retrieval, obtain context or stop"]
    R --> C

    A --> X["Trace and replay store"]
    W --> X
    C --> X
    V -. Approved state updates .-> M["Persistent memory"]
    M --> P
```

**Demonstration sequence:**

1. Fetch current account information through a tool.
2. Reassemble before the next model invocation.
3. Return a newer observation that supersedes an earlier result.
4. Simulate a timeout, insufficient evidence, and an unauthorized tool request.
5. Show bounded recovery or a clear stop.
6. Replay the recorded snapshots through the other assemblers.

Tool results remain evidence. Tool capabilities originate from the application’s capability policy. Execution permission is enforced by the application, independently of the model’s response.

Once this works, add a second model route with its own placement profile. Compare each route independently; different profiles are expected to produce different requests.

**Pass criteria:** every inference has a replayable snapshot; tool results enter through the context boundary; unauthorized calls never execute; recovery terminates; traces link the sequence together.

**What this proves:** CWA remains useful when context changes during execution, including failures and recovery.

---

**Use this comparison harness at every level**

Your existing conformance format already provides most of the foundation:

```text
flowchart TD
    F["Frozen snapshot<br/>Same inputs and declared dependencies"] --> TS["TypeScript assembler"]
    F --> PY["Python assembler"]
    F --> GO["Go assembler"]

    TS --> C["Compare payload, trace and outcome"]
    PY --> C
    GO --> C

    E["Independently reviewed expectations<br/>Existing conformance fixtures plus demo cases"] --> C

    C --> R["Report first difference<br/>Input validation, admission, fitting or rendering"]

    C -->|Assembly passes| L["Separate live model evaluation"]
    L --> M["Grounding, task success, latency and usage"]
```

Follow the existing contract precisely:

- Compare payloads **byte for byte**.
- Compare traces after removing only `trace_id` and `timings`; preserve meaningful array ordering.
- Freeze assembly time, scope, source versions, policy, profile, tokenizer, renderer, variants, and declared conflicts.
- Distinguish **invalid snapshot rejection**, **valid assembly refusal**, and **successful assembly**.
- Record unsupported tokenizer/renderer cases as skipped, never passed.

Prioritize cross-language edge cases already called out by the guide: Unicode ordering, whitespace, timestamp precision, canonical JSON, escaping, and budget rounding.

For live answer evaluation, Promptfoo is an optional addition; keep its model evaluations separate from exact assembler conformance checks. [Promptfoo documentation](https://www.promptfoo.dev/docs/intro/)

**Build the basic inspector and replay harness first.** Reuse them unchanged as you add producers and tool loops. The most useful demo screen is:

**Candidate context → CWA decisions → outbound request → model answer**

That view lets you distinguish a producer error, an assembler error, an adapter error, and a model error without guessing.
