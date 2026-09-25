# The merge stage's hold has no stated lifetime

Shipped: a run-scoped hold now records the stage that placed it and the tip
the placing verdict reported (`TickVerdict.headSha`), and `liftStaleGateHolds`
(`src/loopSupervisor.ts`) drops a gate-stage hold before the next fill
composes the child's key set, once the newest reported tip differs.

Two things for plan:

1. **The spec names gate and provision; merge is silent.** `spec/loop.md`,
   *Repeated identical failures — quarantine, then abort*, says a gate-stage
   hold lifts and a provision-stage hold stays. It says nothing about a
   merge-stage hold, so this tick kept it for the run and said so at the
   site. The gate's own reasoning arguably reaches merge too — a cherry-pick
   conflict is a verdict over one trunk, and a moved trunk is a different
   pick. Either the sentence should name merge or the silence should be
   deliberate; today it reads as an omission.

2. **"The tip moved" is read as "differs from the newest tip a verdict
   reported."** The supervisor holds no ref of its own and reads none — the
   only tip facts it has are the `headSha` values children write. Under
   `maxTicks > 1` two children can report out of order, so a hold placed at
   the newer tip can lift against an older sibling's report. Lifting early is
   the safe direction (the entry is retried, the backstop still bounds the
   burn), but the spec's "moved past" is an ordering claim this approximates
   with inequality. If ordering matters, the engine needs a tip fact with an
   order on it — a per-run counter, or the child reporting its base as well
   as its end.
