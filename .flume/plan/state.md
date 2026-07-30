# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §§4,5,8 shipped; §§2,3,6,7
queued. Mode: **audit** (commit-delta: SUPERVISOR-POLICY-CLI-COVERAGE
shipped; its self-flagged finding routed to a pending entry below).

## Queue (5)

1. `LOOP-SUMMARY-ABORT-THRESHOLD-COUNT` — open (v0.8 §8 audit finding)
2. `PENDING-SCHEMA-CORE-EXTENSION-SPLIT` — **parked** (v0.8 §2; operator
   must land chain.ts's extension declaration in lockstep with the
   build commit)
3. `TAG-GRAMMAR-MECHANICAL-SAFETY` — blockedBy #2 (v0.8 §3)
4. `PENDING-GATE-BUILTIN` — blockedBy #2 (v0.8 §6)
5. `SECOND-REFERENCE-CHAIN` — blockedBy #3 (v0.8 §7)

## Open questions (1)

`BUILD-PARK-COMMIT-BEFORE-BAIL` — unchanged, unrelated to this tick's
delta.

## Trunk

HEAD `40ef723` (SUPERVISOR-POLICY-CLI-COVERAGE ship). Tree clean besides
untracked `.flume/loop.pid` (live supervisor artifact). No spec-delta,
inbox empty; all `blockedBy` tags in the queue still reference live
entries, so no promotions fire this tick.

Plan continues: no
