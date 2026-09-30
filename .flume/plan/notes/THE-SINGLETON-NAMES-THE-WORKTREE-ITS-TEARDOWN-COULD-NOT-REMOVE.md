# The subject a warn line carries is spelled per site, not per speaker

Shipped: `warnSurvivingWorktrees` (`src/worktrees.ts`) is the one spelling of
the surviving-worktree sentence; the wave tail, the startup sweep and both
singleton exits reach it, each supplying its own subject. The singleton's two
teardown calls are now one local leg (`tearDownWorktree`,
`src/singletonTick.ts`), so a future exit cannot re-drop the answer.

Observed while doing it, not filed:

1. The sweep's speaker prefix is a bare literal at five sites in
   `src/worktrees.ts` (`[flume] startup sweep: ...`, :869, :884, :942, :954,
   :961) plus the one it now passes to the shared reporter. Renaming the
   speaker means editing six strings and there is nothing to catch a miss.
   The file already has `SWEEP_BASE_SUBJECT` for the *object* half of that
   vocabulary, so the shape is half-homed. Pure cohesion — no behavior turns
   on it — so an accepted-debt line unless it recurs
   (`engineering.md`, *A module is one job*).

2. `teardownWorktreeInstance` returns `boolean` for "removal succeeded" and
   the surviving path is then rebuilt by each caller from the `wt` it already
   held. Every caller wants the same pair, and the singleton's version of it
   is a one-element array literal. If a third fact ever rides that answer
   (which fallback rung ran, say), the return should become a record rather
   than growing a second out-param. Not worth a change today.

3. Prettier disagrees with all four touched files at HEAD, before and after
   this change — `npx prettier --check` reds `src/worktrees.ts`,
   `src/waveTick.ts`, `src/singletonTick.ts`, `tests/Dispatcher.test.ts`. No
   gate runs it, so this is not a regression I introduced; flagging only so a
   later formatting sweep is not read as this entry's churn.
