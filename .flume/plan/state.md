# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §4 shipped (fb67f0b/90529d3),
§§2,3,5,6,7,8 queued. Mode: **audit** (2 commits since last plan:
REQUIRES-CAPABILITY-GENERALIZATION build + ship, both clean). No
spec-delta, inbox empty, no promotions due this tick.

## Queue (6)

1. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — **parked** (v0.8 §2; operator
   must land chain.ts's extension declaration in lockstep with the
   build commit — core-shrink breaks pendingParseGate otherwise)
2. `TICK-VERDICT-ARTIFACT` — open (v0.8 §5)
3. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #1 (v0.8 §3; widening,
   not shrinking — does not inherit #1's atomicity hazard)
4. `PENDING-GATE-BUILTIN` — blockedBy #1 (v0.8 §6; new unused export
   until chain adopts it — does not inherit #1's hazard either)
5. `SUPERVISOR-POLICY-KNOBS` — open (v0.8 §8)
6. `SECOND-REFERENCE-CHAIN` — blockedBy #3 (v0.8 §7; its
   REQUIRES-CAPABILITY-GENERALIZATION half of the §§2–4 dependency is
   now satisfied — only #3's blockedBy remains)

## Open questions (1)

`BUILD-PARK-COMMIT-BEFORE-BAIL` — voluntary-bail park notes die with
the worktree; recommend a `prompts/build.md` fix (operator leg, same
class as `PROMPTS-BUILD-FENCE-INSTRUCTION`). Unrelated to this tick's
delta, unchanged.

## Trunk

HEAD `90529d3` at this pass's start, tree otherwise clean besides
untracked `.flume/loop.pid` (live supervisor artifact). Audited
`fb67f0b` (build: requiresDockerHost → requiresCapability) and
`90529d3` (ship, pending.json entry removal) against v0.8 §4: gate
union, chain-asserted capabilities, isPickable, status naming the
missing capability, docs, and test coverage (PendingSchema/Dispatcher/
cli, both picked and skipped paths) all match spec intent; `grep -ri
docker src/` empty; tsc clean. No drift found.

Plan continues: no — audit clean, inbox empty, no promotions due.
