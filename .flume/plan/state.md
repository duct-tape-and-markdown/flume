# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §§2,3,4,5,8 shipped; §§6,7
queued. Mode: **audit** (commit-delta: build+ship of TAG-UNIQUENESS-
GATE, checked against v0.8 §3; ship commit itself flagged a live data
bug, checked against §2).

## Queue (3)

1. `SHIP-PENDING-CLOBBER-BUG` — open (v0.8 §2; audit finding — trunk's
   pending.json was corrupt at read time this tick: the retired
   `schemaDelta` field was back in the 2 untouched entries, same
   recurrence as the one 52596fb hand-fixed. Repaired the file this
   tick; root cause is unfound and belongs to Dispatcher's ship-write
   path, not plan)
2. `PENDING-GATE-BUILTIN` — open (v0.8 §6)
3. `SECOND-REFERENCE-CHAIN` — open (v0.8 §7; unblocked, §§2-4 live)

## Open questions (1)

`BUILD-PARK-COMMIT-BEFORE-BAIL` — unchanged, unrelated to this tick's
delta.

## Trunk

HEAD `4c27476` (chore ship TAG-UNIQUENESS-GATE) going in; this commit
brings it current. Tree clean besides untracked `.flume/loop.pid`
(live supervisor artifact — flagged as a race suspect for the clobber
bug, not touched). No spec-delta, inbox empty. TAG-UNIQUENESS-GATE's
build audited clean against §3 (uniqueness enforced on the same
strict path cli/Dispatcher tag-lookups use). tsc clean post-repair.

Plan continues: no
