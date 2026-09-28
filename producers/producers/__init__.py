"""The intermediate stage's producers: everything that runs before assembly and hands the assembler a batch.

Each producer reads its own store under scenarios/intermediate/source/ and returns a producer batch in the shape of
producer_batch.schema.json, bound to the identity the application authenticated. freeze.py composes the batches,
the declared conflict groups, the route policy, the profile and the budget into a frozen snapshot (R-23).
"""
