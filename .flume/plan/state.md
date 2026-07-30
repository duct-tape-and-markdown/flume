# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §§2,3,4,5,8 shipped; §§6,7
queued. Mode: **audit** (commit-delta: ship + TAG-GRAMMAR-MECHANICAL-
SAFETY build, both checked against v0.8 §3).

## Queue (3)

1. `TAG-UNIQUENESS-GATE` — open (v0.8 §3; audit finding — §3's tag
   requirement is non-empty/unique/safe-everywhere, the shipped commit
   only covered charset/whitespace/length)
2. `PENDING-GATE-BUILTIN` — open (v0.8 §6)
3. `SECOND-REFERENCE-CHAIN` — open (v0.8 §7; unblocked, §§2-4 live)

## Open questions (1)

`BUILD-PARK-COMMIT-BEFORE-BAIL` — unchanged, unrelated to this tick's
delta.

## Trunk

HEAD `4ac18d6` (chore ship TAG-GRAMMAR-MECHANICAL-SAFETY). Tree clean
besides untracked `.flume/loop.pid` (live supervisor artifact). No
spec-delta, inbox empty. tsc clean. Corrected a stray `schemaDelta`
field the ship commit had reintroduced into two entries (retired in
PENDING-SCHEMA-CORE-EXTENSION-SPLIT, undeclared in chain.ts's
extension) — pending.json failed to parse against the dogfood
extension until dropped; verified clean post-fix.

Plan continues: no
