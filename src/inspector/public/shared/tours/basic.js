// The basic stage's guided tour: the stops the band walks a visitor through, in order. Data only. Every number and id
// in the copy is a {placeholder} filled from the step the stop selects (its trace, snapshot and scenario.json), and
// test/tour.test.mjs checks each stop against the committed expectation, so a stop cannot claim what the trace lacks.
// `code` in backticks renders in mono, as the spec spells it.

export const STOPS = [
  {
    id: 'welcome',
    at: { step: '01-clean' },
    target: 'columns',
    title: 'One question, four columns: what did CWA assemble, and why?',
    look: 'The four numbered columns, left to right: candidate context, CWA decisions, outbound request, model answer.',
    what: 'A support assistant is asked “{meta.question}”. Before any model sees it, {snapshot.batches.length} producers hand candidate items to a context assembler, which decides what goes in and writes a trace of every decision.',
    why: 'When an answer is wrong, these columns separate a producer’s mistake from the assembler’s, the adapter’s or the model’s. Each step of this stage adds one complication to the same frozen inputs.',
    proves: [],
  },
];
