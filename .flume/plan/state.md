# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §§2,3,4,5,8 shipped; §§6,7
queued. Mode: **audit** (commit-delta: build fix + ship of
SHIP-PENDING-CLOBBER-BUG, checked against v0.8 §2; ship commit itself
reproduced the exact corruption it was meant to close — root-caused).

## Queue (2)

1. `PENDING-GATE-BUILTIN` — open (v0.8 §6)
2. `SECOND-REFERENCE-CHAIN` — open (v0.8 §7; unblocked, §§2-4 live)

## Open questions (2)

- `STALE-GLOBAL-FLUME-LOOP` — **new, urgent**: `.flume/loop.pid`'s live
  loop/tick processes execute a globally npm-installed `@dtmd/flume@0.5.0`
  (pre-fix `commitPendingUpdate`), not this repo's `src/` — confirmed
  root cause of the recurring `pending.json` corruption; needs human
  process/env action, not a code fix.
- `BUILD-PARK-COMMIT-BEFORE-BAIL` — unchanged.

## Trunk

HEAD `38ea981` (ship SHIP-PENDING-CLOBBER-BUG). That ship commit itself
reintroduced the retired `schemaDelta` field into the 2 untouched
entries — same corruption as before, one commit after the fix landed.
Root cause found this tick (see open question): live loop runs a stale
global install, so `6203ee5`'s fix never executes. `6203ee5` itself
audits clean against §2 within its own file scope. Repaired
`pending.json` (stripped `schemaDelta`) again this tick — symptomatic
only, will recur on next ship until the loop is repointed. No
spec-delta, inbox empty, nothing to promote.

Plan continues: no
