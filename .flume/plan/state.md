# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §§2-8 queued. Mode: **audit**
(3 commits since last plan: chain.ts §15 wake wiring + prompt/rule
artifact-discipline change, both clean; plus inbox drain — 2 findings
routed). No spec-delta. Promote: nothing to flip this tick.

## Queue (7)

1. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — **parked** (v0.8 §2; operator
   must land chain.ts's extension declaration in lockstep with the
   build commit — core-shrink breaks pendingParseGate otherwise)
2. `REQUIRES-CAPABILITY-GENERALIZATION` — open (v0.8 §4)
3. `TICK-VERDICT-ARTIFACT` — open (v0.8 §5)
4. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #1 (v0.8 §3; widening,
   not shrinking — does not inherit #1's atomicity hazard)
5. `PENDING-GATE-BUILTIN` — blockedBy #1 (v0.8 §6; new unused export
   until chain adopts it — does not inherit #1's hazard either)
6. `SUPERVISOR-POLICY-KNOBS` — open (v0.8 §8)
7. `SECOND-REFERENCE-CHAIN` — blockedBy #4 (v0.8 §7)

## Open questions (1)

`BUILD-PARK-COMMIT-BEFORE-BAIL` — voluntary-bail park notes die with
the worktree; recommend a `prompts/build.md` fix (operator leg, same
class as `PROMPTS-BUILD-FENCE-INSTRUCTION`).

## Trunk

HEAD `1ba4b97` at this pass's start, tree otherwise clean besides
untracked `.flume/loop.pid` (live supervisor artifact). Audited
`c8ccfd2` (§15 wake-on-bail wiring) and `5867a8b` (artifact-discipline
prompt/rule edit) against their cited sections — both match intent,
no drift. `1ba4b97`'s inbox findings routed: finding 1 → new open
question above; finding 2 → `PENDING-SCHEMA-CORE-EXTENSION-SPLIT`
gate flipped to `parked` with reason. Confirmed #4/#5 don't inherit
#1's atomicity hazard (widening / unused-export respectively).

Plan continues: no — audit clean, inbox drained, promote settled.
