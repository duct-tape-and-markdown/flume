# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §4 shipped (fb67f0b/90529d3);
§5 shipped and now audited clean end-to-end (78d8e23/e288a97 verdict
artifact; 1f445b0/9ae3571 footprint-unification+docs follow-up — this
tick's audit found no further drift); §§2,3,6,7,8 queued. Mode:
**audit** (2 commits since last plan, no spec-delta, inbox empty, no
promotions due).

## Queue (5)

1. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — **parked** (v0.8 §2; operator
   must land chain.ts's extension declaration in lockstep with the
   build commit)
2. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #1 (v0.8 §3)
3. `PENDING-GATE-BUILTIN` — blockedBy #1 (v0.8 §6)
4. `SUPERVISOR-POLICY-KNOBS` — open (v0.8 §8)
5. `SECOND-REFERENCE-CHAIN` — blockedBy #2 (v0.8 §7)

## Open questions (1)

`BUILD-PARK-COMMIT-BEFORE-BAIL` — unchanged, unrelated to this tick's
delta.

## Trunk

HEAD `9ae3571` at this pass's start, tree clean besides untracked
`.flume/loop.pid` (live supervisor artifact). Audited `1f445b0`
(footprint→mergeOutcomes unification + readTickVerdicts docs) +
`9ae3571` (ship) against v0.8 §5: runFanout's per-entry footprint
(cherry-pick-conflict/afterMerge-reverted/afterCommit-reverted) now
sources solely from `mergeOutcomes`, `commitPendingUpdate` derives its
footprint map from that same array, and the new `afterCommit-reverted`
variant covers the one case that previously fed the old `observed` map
without a merge-outcome record. Singleton tick's `snapshotRevertedFiles`
(§8 prose-recovery mechanism) is a distinct, orthogonal path — correctly
untouched. CHAIN-AUTHORING.md §8 documents `readTickVerdicts`. tsc
clean; `pnpm test` 306 passed / 4 skipped. No drift found this pass.

Plan continues: no — audit complete for this delta, inbox empty, no
promotions due.
