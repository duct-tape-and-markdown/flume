# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §4 shipped (fb67f0b/90529d3),
§5 shipped (78d8e23/e288a97) with one gap found this tick; §§2,3,6,7,8
queued. Mode: **audit** (2 commits since last plan: TICK-VERDICT-ARTIFACT
build + ship). No spec-delta, inbox empty, no promotions due this tick.

## Queue (6)

1. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — **parked** (v0.8 §2; operator
   must land chain.ts's extension declaration in lockstep with the
   build commit — core-shrink breaks pendingParseGate otherwise)
2. `TICK-VERDICT-FOOTPRINT-AND-DOCS` — open (v0.8 §5 follow-up; this
   tick's audit finding, see commit body)
3. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #1 (v0.8 §3)
4. `PENDING-GATE-BUILTIN` — blockedBy #1 (v0.8 §6)
5. `SUPERVISOR-POLICY-KNOBS` — open (v0.8 §8)
6. `SECOND-REFERENCE-CHAIN` — blockedBy #3 (v0.8 §7)

## Open questions (1)

`BUILD-PARK-COMMIT-BEFORE-BAIL` — voluntary-bail park notes die with
the worktree; recommend a `prompts/build.md` fix (operator leg, same
class as `PROMPTS-BUILD-FENCE-INSTRUCTION`). Unrelated to this tick's
delta, unchanged.

## Trunk

HEAD `e288a97` at this pass's start, tree clean besides untracked
`.flume/loop.pid` (live supervisor artifact). Audited `78d8e23` (build:
unify tick outcomes into TickVerdict) + `e288a97` (ship) against v0.8
§5: verdict shape, byte-identical errored-derivation (traced against
prior cli.ts logic), writeTickVerdict/clearTickVerdict/readTickVerdicts,
and test coverage (committed/gate-revert/voluntary-bail/cherry-pick-
conflict/afterMerge-reverted, violating-path detail preserved) all
match; tsc clean, `pnpm test` 306 passed. One gap: the shipped entry's
own notes claimed superseding §13 footprint capture, but
commitPendingUpdate's observed/footprint map is untouched and fully
separate from TickVerdict, and the new readTickVerdicts/TickVerdict
export gained no CHAIN-AUTHORING.md coverage — filed as
`TICK-VERDICT-FOOTPRINT-AND-DOCS`.

Plan continues: no — audit complete for this delta, inbox empty, no
promotions due.
