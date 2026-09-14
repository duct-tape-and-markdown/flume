# HARNESS-GATES: uniform gate set per phase; the name-status shell-out is gone

**Uniform set, no per-phase table.** `harnessGates()` returns all four for
every phase — including the two queue-reading ones on build, which never
writes the queue. A per-phase table would be a second copy of the fence to
keep in sync; the cost is a handful of at-ref reads per build commit.
Judgment call, not spec'd (`collaboration.md`, *Push back*) — say if you
want it split.

**Written vs. drained is read, not shelled.** The package's records gate
asks `readFileAtRef` for each touched record at the commit — absent is
deleted — so it needs no `git diff-tree --name-status`. `.flume/chain.ts:264`
still shells for it and carries its own `RECORD_DIRS`/`STATE_ROOT`; the
package reads `ctx.stateRootRel` and composes from `records.ts`. All three
twins (:264, :340, :386) are deletable the tick the chain factory lands and
`.flume/chain.ts` calls `harnessGates`.

`declaration.ts` gained one export, `BUILD_PHASE`, so the phase list and the
records gate's build-vs-plan branch are one fact.
