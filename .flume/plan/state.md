# State

Phase: v0.7 fully shipped (§§1-17); v0.8 §4 shipped (fb67f0b/90529d3);
§5 shipped and audited clean; §8 shipped (fa59ab4/84747ff) and this
tick's audit found a coverage gap (below); §§2,3,6,7 queued. Mode:
**audit** (2 commits since last plan, no spec-delta, inbox empty, no
promotions due).

## Queue (5)

1. `SUPERVISOR-POLICY-CLI-COVERAGE` — open (v0.8 §8 audit follow-up)
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

HEAD `84747ff` at this pass's start, tree clean besides untracked
`.flume/loop.pid` (live supervisor artifact). Audited `fa59ab4`
(supervisorPolicy knobs) + `84747ff` (ship) against v0.8 §8: the
Dispatcher-level mechanism and its `superviseLoop`-options test suite
are sound and byte-identical-by-default as required, but the acceptance
line ("a chain overriding the abort threshold changes supervisor
behavior") was only proven at the options seam — `src/cli.ts`'s
best-effort `resolveChain` + conditional-spread wiring that actually
reads a chain's `supervisorPolicy` block has no test exercising the real
CLI process, and `docs/CHAIN-AUTHORING.md` never gained a section for
the field (unlike `capabilities`, §7). Filed as
`SUPERVISOR-POLICY-CLI-COVERAGE`, open, no blockers. tsc clean;
`pnpm test` 309 passed / 4 skipped.

Plan continues: no — audit complete for this delta, inbox empty, no
promotions due.
