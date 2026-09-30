# Three gate-revert record fields the prompt block never renders

The per-mode case now reads each fixture's own fields off the record
(`ownFieldLines`, tests/Prompt.test.ts) rather than a hand-listed table, so a
field a variant gains is judged by the case already running over it. Two
consequences worth plan's attention:

1. **`GateRevertAttempt.verdict`, `.failingFiles` and `.blamesSpan` reach no
   prompt.** The writer stamps all three (src/priorAttempts.ts:811,:827) and
   the doc comments at src/Prompt.ts:210,:227,:235 say what a retry does with
   them - "a retry keying on *why* the gate refused reads this rather than
   pattern-matching the prose above" - but `modeLines`' gate-revert arm renders
   only `when`, `gate`, `message`, `details`, `diffStat`. The retrying *agent*
   reads the block, not the record, so the stated reader has nothing to read.
   The chain can reach the record via `priorAttempts`, so this is a prompt gap,
   not an engine-surface one. Out of this entry's scope: the fixtures carry none
   of the three, and adding them would red the new loop, which a `pins[]` line
   may not do.
2. The new loop is a generator: a record field that is declared, populated by a
   fixture, and unrendered now reds. That is the intended direction, but it
   means a fixture gaining `blamesSpan: false` reds until the arm renders it -
   a boolean whose *absence* is the ordinary case, so rendering it wants a
   decision, not a reflex fix.

Title kept its "alongside the mode's own fields" claim and the body now backs
it: six `it.each` instances, each asserting every own-field line lands inside
the extracted block, with a vacuity pin that the fixture declares own fields at
all. Mutation-checked by deleting three render lines (`Verdict:`, the
`failureClass` indent, `Observed HEAD:`): three instances red, each named by
field.
