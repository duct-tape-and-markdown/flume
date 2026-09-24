# The covered set is still ungated in the other direction

Shipped as written: `CURSORS` (`harness/planState.ts`) now carries a
`mayMove` rule beside `at` and `of`, sweep's naming the open rotation and
derive's naming none (`movesWhenever`), and the gate applies whichever rule
the cursor it holds carries. The rule fires only where the cursor's value
actually changed — a tick that arms or extends a rotation rewrites sweep's
file without moving the stamp, and a gate keyed on the touched path alone
would have refused exactly the tick that opens a rotation. That arm is
pinned green inside the refusal test, so the distinction cannot be lost.

Observed while building, not filed: the gate now protects the covered set
against a stamp moving out from under it, but nothing holds the set itself.
`.claude/rules/posture-sweep.md`, *The frontier is decidable; the
neighborhood is judged* says covered is settled for the window — a later
tick never re-draws it. A plan commit that shrinks or empties `covered`
while the rotation stays open passes every half of this gate: the cursor
did not move, so no rule is read. It fails the same silent way the stamp
case did — the next tick re-sweeps a neighborhood it already covered and
reads as ordinary work.

That is a second may-move-shaped rule ("the open rotation's covered set only
grows"), and it does not fit the cursor table: its subject is a non-cursor
field, so it would need the gate to judge slice state the cursor machinery
does not reach. Worth a decision on whether the cursor gate widens to
slice-state invariants generally, or whether that property stays with the
sweep prompt as judgement. I did not widen it — outside this entry.
