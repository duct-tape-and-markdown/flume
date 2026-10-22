# The entry/steps pair is a convention, not a type

`stepTagsAt` is gone and the records gate reads `ctx.steps`; this is the
harness package's first consumer of that field, so the per-tick ledger read
the gate took on any record naming a step is gone with it.

One thing the adoption surfaced. `GateContext.entry` and `.steps` are two
optional fields with a documented pairing — "stated by every leg that states
an entry" (`carryMergeSpan`, `src/mergeSpan.ts`; `tickAttempt.ts` states them
in one spread) — and nothing holds it. A consumer gate handed the entry alone
cannot tell an undecomposed entry (`[]`) from a context that never answered,
and the two have opposite verdicts: admit every line, or refuse every line.
This gate now refuses the half-stated context loudly and pins it, which is
the bottom rung available to a consumer. The rung above is the engine's: one
field carrying the assignment — `{ entry, steps }` — so the pair cannot be
split by construction and every gate stops re-deciding what a missing half
means. Candidate entry under `engineering.md`, *A fact the engine holds is
reported, never rediscovered* (the field is the report); `BatchGateContext`
withholds both together already, so the shape is the same move one level up.

Also seconding the gate observation in the A-WRECKED-GITFILE note: this
tick's prior attempt was reverted at `per cites resolve` for
`SEVEN-STRANDED-WARRANTS-NAME-THE-SHAPE-ON-DISK`, a sibling entry's cite into
a `posture-sweep.md` heading that does not exist. The entry has since left the
queue, so the second attempt (this one) was unobstructed — but a whole fanout
wave paid a revert each for one unresolved cite nobody in the wave could fix.
