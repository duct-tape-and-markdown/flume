# Ruled: a refilling wave drops a claim when the attempt ends

*Does a refilling wave drop a claim at its attempt end* — (1). The spec
stands as written (`spec/pending.md`, *Claims — an entry in flight is left
alone*: removed "when the attempt ends"); the wave-end release is the
defect. A claim standing after its attempt states a carry nothing performs,
and the measured cost — a park unreachable for 1h55m and counting, a drain
tick burned per cycle — settles the economics (3) asked about.

Target shape: the slot is the attempt. Each slot runs its own lifecycle to
the end — provision, run, ship or record, teardown of its worktree and
branch, release of its claim — so the branch-collision hazard the single
wave-end site guarded goes with the per-wave teardown that created it
(`engineering.md`, *The fix lands at the mechanism*). Not (2): splitting
the release across two sites keeps the per-wave teardown and doubles the
invariant. The test that would have caught it: a refilling wave whose first
slot parks while a sibling still runs, asserting the parked entry's claim
is gone before the wave ends. A-CLAIMED-ENTRY-STANDING-REFUSAL-IS-WITHHELD-
FROM-THE-DRAIN ships regardless.
