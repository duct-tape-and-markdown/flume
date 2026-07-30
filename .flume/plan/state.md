# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §§2,3,4,5,6,8 shipped (§6's
engine mechanism only — dogfood adoption still open); §7 queued.

Mode: **audit** (commit-delta: PENDING-GATE-BUILTIN ship, checked
against v0.8 §6).

## Queue (1)

1. `SECOND-REFERENCE-CHAIN` — open (v0.8 §7; unblocked, §§2-4 live)

## Open questions (3)

- `STALE-GLOBAL-FLUME-LOOP` — **urgent, still active**: the
  PENDING-GATE-BUILTIN ship (`119a4f1`) reintroduced the retired
  `schemaDelta` field into the untouched SECOND-REFERENCE-CHAIN entry —
  identical corruption, confirms the stale global loop is still running.
  Repaired again this tick; needs human process action.
- `PENDING-GATE-DOGFOOD-ADOPTION` — **new**: chain.ts still hand-rolls
  `pendingParseGate` instead of the shipped `pendingGate` builtin; v0.8
  §6 acceptance not fully closed. Operator leg, outside any phase's
  fence.
- `BUILD-PARK-COMMIT-BEFORE-BAIL` — unchanged.

## Trunk

HEAD `119a4f1` (ship PENDING-GATE-BUILTIN). Engine mechanism audited
clean against §6: composed core+extension validation + fence
pre-check correct, test coverage solid (schema violation, fence
violation naming paths, entryChannelPaths inclusion, custom path,
missing file). Ship's own pending.json rewrite reintroduced
`schemaDelta` corruption again (repaired). No spec-delta, inbox empty,
no blockedBy entries to promote.

Plan continues: no
