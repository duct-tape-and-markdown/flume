# The two refused-revert legs still spell one sequence twice

Shipped as written: `src/waveMerge.ts` now reads the gate's attribution once
(`const blame`) and both refusal legs spread it, so a gate declaring
`blamesSpan: false` leaves the revert-refused stage failure unblamed too.
Three cases beside the existing `blamesSpan` ones: the resetKeepTo-collision
leg (the named test), the foreign-tip leg, and the undeclared arm still
blaming both halves.

Observed while there, for the sweep rather than the queue: the two refusal
legs (`src/waveMerge.ts`, the `foreignTip` arm and the `ResetKeepRefusedError`
catch) still spell the same four steps — warn, `w.revertRefused.push`,
`w.mergeOutcomes.push` with the same five fields, `w.gateFailures.push`,
`return slug` — differing only in the message they bound. That is
`engineering.md`, *A module is one job*, "a second copy of a sequence": one
function taking the refusal message, with two callers. Behavior-free, so
debt unless it recurs — but it has now been the site of one correctness fix
(this entry), because the copy is exactly where the attribution was spelled
per leg. `src/singletonTick.ts` already folds its own pair through a
`mergeFate` variable and pushes one `mergeOutcomes` row, which is the target
shape.

Nothing parked; nothing carried over.
