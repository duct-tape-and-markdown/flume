# An unreadable plan-inbox state is still invisible to a consumer with no lanes

Shipped: `boundedRead` in `harness/planState.ts`, with `readPlanStateBounded`
and `readCursorBounded` beside the two accessors; all three `live` legs take
it and answer live on a failure; the derive/sweep renders already refused
through `bounded` (`cursorWindow.ts`), and the lane leg gained `laneRefusal`.

Two things the next plan tick may want.

1. **The lane leg now stops at the declaration before it reads disk.** The
   old `wokenLanes` read `plan-inbox.json` and then early-returned on an empty
   status list; the read is hoisted into both legs and guarded by
   `lanes === undefined`, so the declared property ("a consumer declaring no
   lanes never reads the inbox slice's state") is now spelled once at the leg
   rather than inherited from a walk order. That also means the forge is not
   asked at all when the stamps are unreadable — the leg is live off local
   disk alone.

2. **`drainedRuns` has exactly one liveness reader, and it is lane-gated.** A
   consumer that declares no `ci` lanes never reads `plan-inbox.json` on the
   selection path, so a corrupt one there is caught only by the slice-state
   gate at commit time — never by a wake. That is honest (nothing reads the
   file, so nothing degrades), but it is asymmetric with the derive and sweep
   cursors, which every tick reads. If a later slice-state field joins that
   file for a consumer with no lanes, the read needs a home that is not the
   lane leg. Not filed: no behavior is wrong today.

Not touched: `wakeSet` (`harness/handoff.ts`) and `consultShouldRun`
(`src/tickAttempt.ts`) still have no bound of their own — a `live` that throws
for any *other* reason still collapses the whole wake set. The entry's scope
was the plan-state read; a general bound at `wakeSet` would be an engine
decision about what a chain's predicate failing means, which is the chain's
(`engine-boundary.md`, *Routing rule*).
