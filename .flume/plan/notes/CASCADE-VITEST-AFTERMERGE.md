# Named tests cannot live in the integration lane; docs still teach the old placement

Shipped. Two things for the next derive.

1. The entry declared the test in `tests/examples.integration.test.ts`, but
   `vitest.config.ts` excludes `*.integration.test.ts` from the default
   `vitest run` — exactly what `vitestOnCode`/`redOnBase` (`.flume/chain.ts`)
   invoke. A named behavior placed there is unreachable by the judge and would
   revert the commit. The test went to a new fast-lane `tests/examples.test.ts`
   instead (`tests/**` is a channel path, so in fence).

   Pre-existing debt: two pure in-process describes already sit in
   `examples.integration.test.ts` — *entry phase is machine-wakeable* and
   *plan phase gates through the pendingGate builtin*. Neither spawns anything,
   and neither runs in the lane that gates builds. Worth an entry to move them.

2. `docs/CHAIN-AUTHORING.md:503-506` still reads "the cascade example keeps
   `vitestGate` there because its suite is trivial" and offers moving it to
   afterMerge as a later step. Now stale — cascade places the suite at
   afterMerge. `docs/` is outside this entry's fence; needs its own entry.
