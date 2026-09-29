// The glossary's entries: the words the spec uses, then the words this demo adds. Each entry is a term, its kind
// (`spec` or `demo`), a definition written from the spec and the docs, and optionally aliases the filter also matches,
// `ids` (identifiers the term covers, shown in mono), `see` (other terms, by name) and `rules` (the requirements it
// rests on). Data only: a test checks that every cross-reference and rule exists and that the vocabulary is covered.

/** An entry's anchor: lowercase, non-alphanumerics folded to one hyphen. */
export const slugOf = term => String(term).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const TERMS = [
  // The spec's words.
  {
    term: 'Context Window Architecture', aliases: ['CWA'], kind: 'spec',
    text: 'A specification for assembling a model call, not a library. It fixes what goes into the context window, in which slot and with what authority, and requires a trace that accounts for every decision. Three independent assemblers implement it; this demo runs them side by side on the same inputs.',
    see: ['assembler', 'trace'],
  },
  {
    term: 'assembler', kind: 'spec',
    text: 'The component that turns a snapshot into a rendered payload and a trace, or a refusal. It admits items, resolves declared conflicts, fits the budget in tier order and renders in the profile\'s order. It never calls a model and never decides what is true.',
    see: ['snapshot', 'admission', 'fitting', 'rendering', 'refusal'], rules: ['R-5', 'R-18', 'R-23'],
  },
  {
    term: 'snapshot', kind: 'spec',
    text: 'The immutable input to one assembly: every producer\'s batch, the declared conflict groups, the route policy, the profile, the budget, the assembly time, the tokenizer and the renderer. Identical snapshots give identical bytes, and the trace records the snapshot\'s digest.',
    see: ['batch', 'route', 'profile', 'budget', 'snapshot digest'], rules: ['R-22', 'R-23'],
  },
  {
    term: 'snapshot digest', kind: 'spec',
    text: 'The lowercase SHA-256 of the snapshot serialised as canonical JSON, recorded in the trace as context.snapshot_digest, so a trace can be tied to exactly the input that produced it. This demo recomputes it with a second implementation to check the first.',
    see: ['canonical JSON'], rules: ['R-22'],
  },
  {
    term: 'item', kind: 'spec',
    text: 'The unit of context. Every item names one slot and one authority and carries eight minimum fields: id, slot, source, source_version, authority, freshness, trust and body. Six policy fields (token_budget, variants, conflict_policy, lineage, eligibility, injection_risk) are filled from the slot\'s defaults when omitted, and the trace says so.',
    see: ['slot', 'authority', 'slot defaults'], rules: ['R-1', 'R-2', 'R-3'],
  },
  {
    term: 'slot', kind: 'spec',
    ids: ['governance.instructions', 'governance.capabilities', 'governance.examples', 'governance.output_contract', 'state.user', 'state.task', 'evidence.knowledge', 'evidence.tool_results', 'interaction.memory', 'interaction.history', 'interaction.query'],
    text: 'One of the eleven named places an item can go, each in one plane, each with published defaults for tier, authority, lineage, injection risk and conflict policy. An item naming any other slot is excluded with unknown_slot. The instructions and the query are never omitted; the output contract is never omitted when a parser reads the answer.',
    see: ['plane', 'slot defaults'], rules: ['R-1', 'R-3', 'R-4'],
  },
  {
    term: 'plane', kind: 'spec',
    text: 'One of the four groups of slots. Each answers a different question and they are never merged: governance (who may direct the model), state (what is true right now), evidence (what the model may ground on) and interaction (what has happened, and what is asked). In the inspector a candidate is coloured by its slot\'s plane and by nothing else.',
    see: ['governance plane', 'state plane', 'evidence plane', 'interaction plane'],
  },
  {
    term: 'governance plane', kind: 'spec', ids: ['governance.instructions', 'governance.capabilities', 'governance.examples', 'governance.output_contract'],
    text: 'Who may direct the model: the instructions (identity, goals, refusals, safety boundaries), the capabilities the model may invoke, developer-owned steering examples, and the output contract. Only governing-authority items enter it; an item that is not verified, or that carries the injection marker, is excluded here.',
    see: ['authority', 'capability'], rules: ['R-4', 'R-10', 'R-15'],
  },
  {
    term: 'state plane', kind: 'spec', ids: ['state.user', 'state.task'],
    text: 'What is true right now: the durable user profile and entitlements, and the task\'s workflow stage, approvals, selected entities and pending action. State is written by the application, current at assembly time (stale_state otherwise), admitted only from producers of kind state, and never written from model output.',
    see: ['freshness'], rules: ['R-8'],
  },
  {
    term: 'evidence plane', kind: 'spec', ids: ['evidence.knowledge', 'evidence.tool_results'],
    text: 'What the model may ground on: retrieved chunks, each its own scored item, and observations returned by tools already called. Evidence informs the answer and never directs behaviour; tool output is evidence, not permission to act.',
    see: ['relevance', 'observation'], rules: ['R-13', 'R-15'],
  },
  {
    term: 'interaction plane', kind: 'spec', ids: ['interaction.memory', 'interaction.history', 'interaction.query'],
    text: 'What has happened, and what is asked: condensed memory linked to the turns it came from, the verbatim transcript of recent turns, and the live query the model must answer. The query is never omitted and always carries user authority; prior model turns carry untrusted, so they cannot instruct.',
    see: ['freshness', 'placement'], rules: ['R-4', 'R-7', 'R-9'],
  },
  {
    term: 'producer', kind: 'spec',
    text: 'A component that sends a batch of candidate items: a retriever, a memory store, a state service, an MCP adapter, a capability policy, the conversation. Its identity and kind come from the route policy and the application\'s authentication, never from item fields; a producer the route does not list is excluded with producer_not_authenticated.',
    see: ['batch', 'route'], rules: ['R-9', 'R-13', 'R-14', 'R-15'],
  },
  {
    term: 'batch', kind: 'spec',
    text: 'One producer\'s contribution to a snapshot: its candidate items and the exclusions it made itself, such as an expired memory or a near-duplicate chunk, each reported with a reason code and stage: producer. A snapshot holds at most one batch per producer.',
    see: ['producer', 'exclusion'], rules: ['R-9', 'R-13', 'R-15'],
  },
  {
    term: 'route', aliases: ['route policy'], kind: 'spec',
    text: 'The application\'s versioned policy for one kind of request: which producers it lists and with what kind, the rules per slot (min_relevance, max_age_seconds, required_scope, source_prefix, dedupe, supersede, max_per_source, max_tokens, min_tokens, tier upgrades), the fact policies for declared conflicts, what to do when a conflict cannot be resolved, whether a parser consumes the answer, and the budget. The profile names the route and its policy version.',
    see: ['profile', 'conflict group', 'budget'], rules: ['R-3', 'R-11', 'R-20'],
  },
  {
    term: 'profile', aliases: ['placement profile'], kind: 'spec',
    text: 'Where the slots render and inside what: a versioned, per-route list of placements with wrapper rules, tied to a route policy version and a model family, with an evaluation status. A slot may be placed twice and is counted twice. Any change to placement increments the version; a draft is unevaluated until a suite says otherwise.',
    see: ['placement', 'route', 'rendering'], rules: ['R-19', 'R-20'],
  },
  {
    term: 'placement', aliases: ['wrapper'], kind: 'spec',
    text: 'One entry of a profile: a slot and how it renders, as the system channel, the tools list, or a named wrapper such as xml:evidence. Prior turns render inside the history wrapper as a transcript, never as platform messages; only the query renders as the live user turn.',
    see: ['profile'], rules: ['R-7', 'R-20'],
  },
  {
    term: 'authority', kind: 'spec',
    text: 'One of seven values every item carries: governing, user, state, reference_only, observation, generated or untrusted. Only governing and user items may instruct; the other five say where data came from and never rank which facts are true. An item gains no authority from imperative wording in its body.',
    see: ['trust', 'injection risk'], rules: ['R-1', 'R-6', 'R-7'],
  },
  {
    term: 'trust', kind: 'spec',
    text: 'verified, unverified or untrusted: the producer\'s own claim about its source, so on its own it proves nothing. Only the governance gate reads it, admitting verified items alone; it never decides who may instruct or which fact wins.',
    see: ['authority'], rules: ['R-10', 'R-11'],
  },
  {
    term: 'injection risk', aliases: ['injection_risk', 'untrusted content'], kind: 'spec',
    text: 'none or untrusted_content: whether the body might carry an injection. Quoted user material, attachments, retrieved chunks, memory and tool output are marked untrusted_content whatever their authority, and an unmarked item in a slot whose default is untrusted_content is excluded. The marker never changes authority or where an item renders.',
    see: ['authority', 'trust'], rules: ['R-10', 'R-15'],
  },
  {
    term: 'tier', aliases: ['protected', 'compressible', 'droppable'], kind: 'spec',
    text: 'What happens to an item under budget pressure. protected: rendered whole or the assembly is refused. droppable: may be omitted, and goes first. compressible: may take a supplied variant or be omitted, once droppable items are gone. Only the route may raise a slot\'s tier; an item that claims a higher tier than its slot allows is excluded.',
    see: ['fitting', 'variant', 'protected content'], rules: ['R-16'],
  },
  {
    term: 'lineage', kind: 'spec',
    text: 'How the body came to be: verbatim, summarised, redacted, translated, extracted or generated. Prior model turns in the history carry lineage generated and authority untrusted; a variant carries a lineage of its own.',
    see: ['variant'], rules: ['R-1', 'R-18'],
  },
  {
    term: 'variant', kind: 'spec',
    text: 'A shorter body the producer computed before assembly, with its own id, body, method and lineage, inheriting the item\'s provenance, scope and authority. Fitting may select a supplied variant for a compressible item; it never writes one and never calls a model. The trace records each selection as a compressed row.',
    see: ['compression', 'tier'], rules: ['R-18'],
  },
  {
    term: 'freshness', aliases: ['expires', 'assembly time'], kind: 'spec',
    text: 'freshness is when the fact was observed or true, an RFC 3339 instant compared at full precision; it is not an expiry. expires is a separate deadline: an item whose expires is at or before assembly_time is expired. assembly_time is the snapshot\'s own clock, so the same snapshot expires the same items on any day.',
    see: ['snapshot'], rules: ['R-2', 'R-9', 'R-23'],
  },
  {
    term: 'scope', kind: 'spec',
    text: 'Keys an item carries about where it applies: tenant, user, session, task, locale, workflow step. An item whose value differs from the request\'s, or that lacks a key its slot requires, is excluded as out_of_scope. A missing key is never a wildcard.',
    see: ['admission'], rules: ['R-2'],
  },
  {
    term: 'eligibility', kind: 'spec',
    text: 'A short note on why an item belongs in the request, for whoever reads the trace. It is text, not code: the route\'s versioned slot rules are the predicate that decides, and those rules (min_relevance, max_age_seconds, required_scope, source_prefix) are the complete set.',
    see: ['route'], rules: ['R-3'],
  },
  {
    term: 'relevance', kind: 'spec',
    text: 'The rerank score a retrieval producer puts on each chunk before assembly, on the producer\'s own scale. An item scoring below its slot\'s min_relevance, or carrying no score where the route sets one, is excluded with below_threshold; a score equal to the threshold passes.',
    see: ['producer'], rules: ['R-13', 'R-18'],
  },
  {
    term: 'conflict group', kind: 'spec',
    text: 'A declared disagreement the application hands to the assembler: an id, a kind (instruction or fact), the members, and for facts the key the route\'s policy decides. Instruction groups follow platform roles, then governing over user, then the peers\' conflict policies; fact groups follow the route\'s producer precedence, with freshness breaking ties only among leaders. The trace records who decided: authority, policy, freshness, escalated or moot. No conflict excludes a protected item, and the assembler never infers a contradiction by reading prose.',
    see: ['resolution', 'route'], rules: ['R-6', 'R-11'],
  },
  {
    term: 'admission', kind: 'spec',
    text: 'The assembler\'s first pass over every candidate: schema and required fields, producer identity and kind, slot and authority, scope, age, expiry, the injection marker, the route\'s threshold. Whatever fails is excluded with the earliest applicable reason code in the registry\'s order, and stays in the trace.',
    see: ['exclusion', 'reason code'], rules: ['R-1', 'R-2', 'R-3', 'R-21'],
  },
  {
    term: 'resolution', aliases: ['supersession', 'deduplication', 'source diversity'], kind: 'spec',
    text: 'After admission and before fitting: the declared conflict groups are settled, then, in the slots where the route asks, older observations of the same source are superseded (superseded), equal bodies are deduplicated (duplicate_content), and each producer and source is capped (source_diversity_cap), in that order. Protected items and conflict members are never removed by these steps.',
    see: ['conflict group', 'observation'], rules: ['R-11', 'R-24', 'R-25', 'R-26'],
  },
  {
    term: 'fitting', aliases: ['budget pressure', 'shedding'], kind: 'spec',
    text: 'Making the payload fit budget.input. Item and slot caps apply first, whether or not the payload fits. Then, under pressure, the assembler sheds in tier order: droppable items are omitted, then compressible items take a variant or are omitted in the route\'s fitting order, each omission traced as over_budget. Protected items are never touched: if they alone do not fit, the assembly is refused.',
    see: ['tier', 'budget', 'refusal'], rules: ['R-16', 'R-17'],
  },
  {
    term: 'rendering', kind: 'spec',
    text: 'Writing the payload in the profile\'s placement order with the declared renderer, counting every emitted token with the declared tokenizer, wrappers and repeated slots included, and hashing the result. This demo renders each step twice: fixture-xml/v1 to compare bytes, cwa-messages/v1 for the model.',
    see: ['renderer', 'tokenizer', 'payload'], rules: ['R-16', 'R-21'],
  },
  {
    term: 'budget', aliases: ['budget.input', 'reserved_output', 'margin_percent'], kind: 'spec',
    text: 'budget.input is the most rendered input tokens the payload may hold after budget.reserved_output is set aside from the model\'s context limit for the answer; the providers send reserved_output as max_tokens. budget.margin_percent reserves a safety margin for a tokenizer that estimates. In the inspector the budget field reassembles live and marks the snapshot derived.',
    see: ['fitting', 'derived'], rules: ['R-16'],
  },
  {
    term: 'tokenizer', kind: 'spec',
    text: 'The declared way of counting tokens, named in the snapshot and repeated in the trace. This demo uses fixture-whitespace/v1 in both renderings so the count is portable and the fitting decisions are identical; a production route names the model\'s tokenizer, or estimate-utf8/v1 with a margin.',
    see: ['budget'], rules: ['R-16', 'R-23'],
  },
  {
    term: 'renderer', aliases: ['fixture-xml/v1', 'cwa-messages/v1'], kind: 'spec',
    text: 'The declared output format. fixture-xml/v1 is the conformance renderer: one text the three assemblers must reproduce byte for byte. cwa-messages/v1 is the request IR a provider sends: system entries, tools, and the user message, which the inspector shows as the literal SDK call.',
    see: ['rendering', 'payload', 'provider'],
  },
  {
    term: 'payload', kind: 'spec',
    text: 'The rendered UTF-8 bytes the model receives, with result.hash its lowercase SHA-256 and result.input_tokens its count. The harness compares payloads byte for byte across assemblers. A refused assembly has no payload at all.',
    see: ['refusal', 'agreement'], rules: ['R-17', 'R-21'],
  },
  {
    term: 'trace', kind: 'spec',
    text: 'The JSON record of every decision, matching the published schema: the profile and budget, the context (assembly time, tokenizer, renderer, snapshot digest), the result, and the rows: included (one per rendered occurrence), compressed, excluded (with reason and stage), conflicts, defaults_filled, refused, and a recovery action when a refusal records one. The inspector\'s second column is the trace.',
    see: ['exclusion', 'compression', 'refusal'], rules: ['R-21', 'R-22'],
  },
  {
    term: 'reason code', kind: 'spec',
    text: 'The registered name for an exclusion or a refusal, from the contract\'s reasons.json, each tied to the rule that defines it. When several apply, the earliest in the registry\'s order is recorded. Click any reason code in the inspector to open this glossary at it.',
    see: ['exclusion', 'refusal'], rules: ['R-21'],
  },
  {
    term: 'exclusion', aliases: ['excluded'], kind: 'spec',
    text: 'An item left out, with a reason code and a stage. stage: producer means the producer suppressed it and reported it (an expired memory, a near-duplicate chunk); stage: assembler means admission, resolution or fitting removed it. Both stay in the trace, and both show in the candidate column with the code as a chip.',
    see: ['reason code', 'admission'], rules: ['R-9', 'R-13', 'R-21'],
  },
  {
    term: 'refusal', aliases: ['refused'], kind: 'spec',
    text: 'The outcome for a valid snapshot the assembler will not render: protected content that cannot fit, a required slot with no admitted item, a floor that cannot be kept, an unresolved conflict, or too little evidence. No payload; the trace keeps every earlier decision, sets refused.bool with the reason, and may record recovery.action. In the inspector the request and answer columns turn the accent and nothing is sent.',
    see: ['rejection', 'fitting'], rules: ['R-4', 'R-11', 'R-12', 'R-17'],
  },
  {
    term: 'rejection', aliases: ['rejected'], kind: 'spec',
    text: 'A snapshot that fails its schemas or the snapshot checks is rejected before assembly: no payload and no trace, and the adapter exits 2 with the problems on stderr. A rejection is the application\'s error in building the snapshot; a refusal is an outcome of a valid one.',
    see: ['refusal', 'adapter'], rules: ['R-17'],
  },
  {
    term: 'compression', aliases: ['compressed'], kind: 'spec',
    text: 'Replacing a compressible item\'s body with one of its supplied variants during fitting, or to keep it under its own token_budget or its slot\'s max_tokens. The trace\'s compressed row records the item, the variant, the method and the token counts from and to; the candidate row shows its plane at half strength.',
    see: ['variant', 'tier'], rules: ['R-16', 'R-18'],
  },
  {
    term: 'protected content', kind: 'spec',
    text: 'Items in the protected tier: the instructions, the output contract, the query, the task state, and whatever else the route raises. They render whole or not at all; item metadata cannot lower them, and fitting never truncates or omits them. When they alone exceed the budget the assembly is refused with protected_content_over_budget.',
    see: ['tier', 'refusal'], rules: ['R-16', 'R-17'],
  },
  {
    term: 'capability', aliases: ['grant', 'capability policy'], kind: 'spec',
    text: 'A tool the model may invoke, entered as a governance.capabilities item. MCP servers propose tools; only the route\'s versioned capability policy, an authenticated producer, may grant them, and the grant travels in the snapshot so the assembler can exclude any capability it did not name (capability_not_allowed). A grant is not permission to call: the guard still checks every request.',
    see: ['MCP', 'guard', 'observation'], rules: ['R-15'],
  },
  {
    term: 'observation', kind: 'spec',
    text: 'What a tool returned, entered as an evidence.tool_results item whose source names the call and its arguments and whose authority is observation. Evidence, not permission to act. With supersede: source on the slot, the latest observation of the same call stays and the earlier ones are traced as superseded.',
    see: ['capability', 'resolution'], rules: ['R-15', 'R-25'],
  },
  {
    term: 'MCP', aliases: ['Model Context Protocol'], kind: 'spec',
    text: 'The protocol the advanced stage\'s servers speak: they list the tools they offer and return results when called. Their results are evidence, marked untrusted_content unless the route verifies the server, and never enter governance; a tool specification a server emits straight into governance.capabilities is excluded.',
    see: ['capability', 'observation'], rules: ['R-15'],
  },
  {
    term: 'rule zero', kind: 'spec',
    text: 'Language guidance goes in context; enforceable invariants go outside the model. Governance may say "never quote an unverified price", and a tool guard enforces it. An assembler never relies on context to enforce anything.',
    see: ['guard'], rules: ['R-5'],
  },
  {
    term: 'requirement', aliases: ['R-n'], kind: 'spec',
    text: 'The spec\'s numbered rules, R-1 to R-26, each with an RFC 2119 keyword. Numbers are permanent. Where a requirement leaves an ordering or a boundary open, the conformance README is normative. The inspector cites them as R-n beside reason codes and filled defaults.',
    see: ['conformance'],
  },
  {
    term: 'conformance', kind: 'spec',
    text: 'The published cases and rejections an assembler must reproduce: for each case the exact payload bytes and the trace, minus trace_id and timings. This demo vendors them and runs all of them through every assembler as the harness\'s own self-check before it is trusted with the scenarios.',
    see: ['agreement', 'harness'], rules: ['R-21', 'R-23'],
  },
  {
    term: 'slot defaults', aliases: ['defaults filled'], kind: 'spec',
    text: 'The published policy per slot: plane, authority, tier, lineage, injection risk, conflict policy. When an item omits a policy field the assembler fills it from here, with any route override versioned, and records one defaults_filled row per field. The decisions column says how many were filled.',
    see: ['slot', 'item'], rules: ['R-3', 'R-22'],
  },
  {
    term: 'canonical JSON', aliases: ['I-JSON', 'RFC 8785'], kind: 'spec',
    text: 'How a snapshot is digested and compared: keys in UTF-16 code unit order, numbers as IEEE 754 doubles, strings well-formed Unicode. Three implementations in three languages must serialise the same snapshot to the same bytes, which is what the digest check in this demo tests.',
    see: ['snapshot digest'], rules: ['R-2', 'R-22'],
  },

  // This demo's words.
  {
    term: 'the demo', aliases: ['inspector', 'cwa-demo-app'], kind: 'demo',
    text: 'A support-assistant scenario run through the three conformant assemblers (Python, TypeScript, Go) on the same frozen inputs, with every decision shown on one screen. The app never assembles: it freezes inputs, hands them to an assembler through the adapter protocol, compares what comes back, and shows it.',
    see: ['stage', 'the four columns', 'adapter'],
  },
  {
    term: 'stage', kind: 'demo',
    text: 'One of the three parts of the demo, each its own page. Basic: frozen fixtures, five steps, one question. Intermediate: real producers (LlamaIndex retrieval, an account database, a memory store, the conversation) competing for a budget, six steps. Advanced: a bounded tool loop over MCP servers, recorded runs on two routes.',
    see: ['step', 'producer', 'controller'],
  },
  {
    term: 'step', aliases: ['turn'], kind: 'demo',
    text: 'One frozen snapshot in a stage\'s progression, chosen from the pills under the masthead or with the arrow keys. Each step adds to the last, so the audience watches one snapshot grow and the decisions change. On the advanced page the pills are the turns of a run, each an inference with its own snapshot.',
    see: ['delta strip', 'frozen'],
  },
  {
    term: 'the four columns', kind: 'demo',
    text: 'Every stage page reads left to right: 1 Candidate context (what the producers sent, coloured by plane, each outcome named), 2 CWA decisions (the trace, with the budget meter), 3 Outbound request (the payload, or no request at all), 4 Model answer (a live call, the exact request beside it). The view separates a producer error from an assembler error from an adapter error from a model error.',
    see: ['candidate', 'trace', 'payload', 'provider'],
  },
  {
    term: 'candidate', kind: 'demo',
    text: 'An item as a producer sent it, before the assembler decided. The first column lists every candidate in its slot\'s plane with its outcome as a chip: included, compressed, excluded with the code, admitted but assembly refused, not placed, or reported excluded by the producer.',
    see: ['item', 'exclusion'],
  },
  {
    term: 'frozen', kind: 'demo',
    text: 'A committed snapshot with its clock inside it, so the same bytes go to all three assemblers today and next year. Basic snapshots are generated from one source; intermediate ones are built by the real producers and frozen; the frozen button returns to the committed snapshot after a budget change.',
    see: ['derived', 'live', 'snapshot'],
  },
  {
    term: 'derived', kind: 'demo',
    text: 'A snapshot the inspector rebuilt from a frozen one with a different budget, marked with an accent badge. It is assembled and compared across assemblers like any other, but no expectation applies to it, because none was reviewed for it.',
    see: ['frozen', 'expectation', 'budget'],
  },
  {
    term: 'live', kind: 'demo',
    text: 'Run now rather than replayed. On the intermediate page the producers run against the corpus and the stores and the result is compared with the frozen step; a differing digest is the loudest badge. On the advanced page a run goes against a real model. Answers in the fourth column always come from a real provider.',
    see: ['frozen', 'recorded', 'replay'],
  },
  {
    term: 'recorded', aliases: ['reference run'], kind: 'demo',
    text: 'An advanced-stage run against a real model, committed with every inference\'s snapshot, trace, payload, request, response and tool decisions. The reference runs are the stage\'s regression suite; live runs are kept out of the repository.',
    see: ['replay', 'live'],
  },
  {
    term: 'replay', kind: 'demo',
    text: 'Feeding a recorded run\'s snapshots back through any assembler and judging each result against the recorded trace. Replay proves the assembler reproduces what it did when the model was on the line, without the model.',
    see: ['recorded', 'agreement'],
  },
  {
    term: 'expectation', aliases: ['unreviewed'], kind: 'demo',
    text: 'The expected payload and trace for a step, generated from a named assembler and committed. scenario.json records which assembler and whether a person has reviewed it; an unreviewed expectation shows as an accent badge, since three assemblers can share a mistake and a reviewed expectation is the independent check.',
    see: ['agreement', 'harness'],
  },
  {
    term: 'agreement', kind: 'demo',
    text: 'Every assembler that ran returned the same payload bytes and the same trace fields, minus trace_id and timings. The badge says how many ran; a disagreement is the loudest badge on the page and a finding, never something to normalise away.',
    see: ['expectation', 'conformance'],
  },
  {
    term: 'adapter', kind: 'demo',
    text: 'The command that runs one assembler the way the harness runs all three: the snapshot\'s bytes on stdin, an exit code (0 assembled or refused, 2 rejected, 3 unsupported), and the payload and trace on stdout. The TypeScript assembler goes through an adapter too, so no assembler has a shortcut.',
    see: ['harness', 'rejection'],
  },
  {
    term: 'harness', kind: 'demo',
    text: 'The comparison runner behind the inspector and the command line: it runs a snapshot through every available assembler, judges each result against the expectation as the conformance runner would, and reports agreement. compare, expect and conformance are its commands.',
    see: ['adapter', 'agreement', 'conformance'],
  },
  {
    term: 'instruments', kind: 'demo',
    text: 'The controls under the step band: the assembler whose trace the columns show, the rendering (fixture-xml/v1 to compare, cwa-messages/v1 for the model), and budget.input, which reassembles live. In talk mode they fold behind one line that summarises them.',
    see: ['talk mode', 'renderer', 'budget'],
  },
  {
    term: 'talk mode', kind: 'demo',
    text: 'The masthead button for a projector: larger type everywhere, the instruments folded behind one line, and each candidate\'s tertiary line hidden. Remembered per browser. It changes sizes, never colours or shapes.',
    see: ['instruments'],
  },
  {
    term: 'delta strip', kind: 'demo',
    text: 'The hairline grid under the step header saying what changed since the step you came from: budget, candidates, conflicts, the included, compressed and excluded counts, the input tokens, and the reason codes new to this step. It compares with the last step the page showed, so a jump from step 1 to step 4 compares with step 1 and says so.',
    see: ['step'],
  },
  {
    term: 'budget meter', aliases: ['outcome band'], kind: 'demo',
    text: 'The bar in the decisions column\'s outcome band: one segment per included item, in its slot\'s plane, at half strength when the item went in as a summary, with what is free after it. It is drawn from the trace\'s rows and the snapshot\'s budget and computes nothing the assembler did not decide. On a refusal the band turns the accent and names the reason.',
    see: ['fitting', 'compression'],
  },
  {
    term: 'controller', aliases: ['tool loop'], kind: 'demo',
    text: 'The advanced stage\'s application: for each turn it freezes a snapshot (policy, state, retrieval, the observations so far, the conversation, the grant), has it assembled, sends the payload to the model, and either validates the answer against the output contract or hands the tool request to the guard. Bounded by max_turns and max_recoveries; on the last turn it offers no tool.',
    see: ['guard', 'capability', 'observation'],
  },
  {
    term: 'guard', kind: 'demo',
    text: 'The check every tool request passes before a call, outside the model: is the tool granted, do the arguments match the tool\'s schema, is the request within scope. A denied request is never executed and produces no observation; the model learns of it from the task state on the next turn. Rule zero, applied.',
    see: ['rule zero', 'controller'],
  },
  {
    term: 'provider', kind: 'demo',
    text: 'Where the fourth column\'s answer comes from: a local OpenAI-compatible server, OpenAI, or Anthropic, configured in .env. A provider takes a cwa-messages/v1 payload and nothing else, so a refusal can never reach a model, and the inspector shows the exact request it sent.',
    see: ['renderer', 'snippet'],
  },
  {
    term: 'snippet', kind: 'demo',
    text: 'The assembled request as the code an application writes, in TypeScript and Python, under the outbound request: the literal client.messages.create(...) or client.chat.completions.create(...) call. The object in the call is built by the same code the providers use, so the snippet is the request, not an illustration.',
    see: ['provider'],
  },
  {
    term: 'look for', aliases: ['proves'], kind: 'demo',
    text: 'The line under each step title: what the step proves, and the reason codes it was designed to show, as chips. Each is one of the registry\'s codes, and a test checks that every one of them appears in the step\'s expected trace.',
    see: ['reason code', 'expectation'],
  },
];
