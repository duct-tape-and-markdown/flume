# The two count-flag refusal copies are unpinned against each other

Shipped: `parseMaxValue` (`src/cliArgs.ts`) tests `/^[0-9]+$/` and keeps the
`Number.isFinite` guard, so an overlong digit run stays refused rather than
becoming an unbounded budget. Both named tests fail on the pre-fix tree
(measured by reverting `src/cliArgs.ts` alone); full suite green.

Two things for the next plan tick.

1. **Unpinned prose copy.** `docs/CLI.md` states the `--max`/`-n` refusal
   class twice (the `flume loop` and `flume log` sections) and `src/cliHelp.ts`
   states it twice more in its exit-2 rows. Nothing ties them: the pins in
   `tests/cliHelp.test.ts` cover the exit-2 *code* and the shared state-root
   causes, not this cause list — unlike the 74 rows, which have
   CLI-DOC-SHARED-ROOT-CAUSES-PINNED-PER-VERB. Four hand copies of one class,
   free to drift the way the tick-exit-code range already did. The producer is
   `parseMaxValue`'s predicate; a pin driving it over the class the rows name
   would be the agreement gate (`engineering.md`, *A seam gate reads what the
   real writer wrote*).

2. **Vocabulary split with the sibling reading.** `decodeTipClaimHandoff`
   (`src/cliRunContext.ts`) refuses the same class with `/^[1-9][0-9]*$/`, so
   it refuses `007` where `parseMaxValue` takes it as 7. Deliberate here — the
   entry's acceptance keeps every decimal value's current behaviour, and a
   count admits 0 where a pid does not — but the two predicates are one job
   spelled twice, and a third numeric flag would pick one by coin toss. A
   shared "decimal integer, optionally zero" reading with the two callers
   naming their floor is the target shape if this recurs
   (`engineering.md`, *A module is one job*).
