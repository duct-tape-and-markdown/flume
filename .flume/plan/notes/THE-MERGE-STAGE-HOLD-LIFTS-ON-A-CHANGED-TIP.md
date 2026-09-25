# The lift's stage set is now the surface a third stage would edit

Shipped: `LIFTS_ON_A_MOVED_TIP` (`src/loopSupervisor.ts`) is a membership set
over `FAILURE_STAGES`, holding `gate` and `merge`; `liftStaleHolds` (renamed
from `liftStaleGateHolds`) reads it and names the lifted stage in its log line
rather than spelling one. Chosen over `hold.stage !== "provision"` so a stage
added to the roster keeps the run-scoped default until that line says
otherwise — the safe direction, since an unknown stage's judgment is not
known to be tip-scoped.

Two things a later tick may want:

1. The describe title of the lift suite changed — it was
   "superviseLoop — a gate-stage hold expires with the tip it was placed at",
   now "superviseLoop — a gate- or merge-stage hold expires with the tip it
   was placed at", since it holds all three stage arms. If any stamped entry's
   `tests[]`/`pins[]` line was recorded as a full name under the old describe,
   its spelling is stale.

2. The lift is only reachable from `fill()`, so a run that starts no further
   child never lifts. Harmless today (a lift only matters to a child being
   started) but it means no verdict surface reports a lift — a chain reading
   `TickResult.quarantinedTags` sees the hold disappear with no fact saying
   why, only the log line. If a chain ever needs to distinguish "lifted" from
   "never held", that is an engine-reports-its-facts finding
   (`engineering.md`, *A fact the engine holds is reported*), not a chain's to
   infer from two consecutive tag sets.
