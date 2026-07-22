# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit JOB-FANOUT-NS ship

Delta = 1 build commit + 1 chore ship (`ece8c2c`, `4ae3817`); no spec changes; inbox empty.

**Audit `ece8c2c` (JOB-FANOUT-NS vs §4)**: conforming on everything §4 names. Branch naming with/without namespace exact; namespace flows CLI→`DispatcherOptions.namespace`, dispatcher never sniffs flumeDir; teardown deletes `wt.branch` by created name (`src/Dispatcher.ts:846`) — verified, not just claimed. All three §7-§4 asserts present in tests/Dispatcher.test.ts, plus a real-CLI env-resolution e2e in tests/cli.test.ts. Scope = the four declared files exactly.

**Finding → filed**: branch is namespaced but the worktree **path** is still slug-keyed (`join(wtBase, slug)`, `src/Dispatcher.ts:1114`). Default per-job base is disjoint, but a shared `FLUME_WORKTREES_DIR` (the sanctioned escape hatch, plausibly set globally per its own stray-write rationale) collides across concurrent jobs on identical slugs — and stale-cleanup (`:1115`) rm -rfs the foreign **live** worktree. That exceeds §6's accepted-contention bar (fail a tick, not the repo). Filed **JOB-FANOUT-PATH** (open, per §4) — fix is mechanical: mirror the branch namespacing in the path.

**Routing completed**: prior tick's accepted debt (`--job` name-shape unvalidated) made actionable in JOB-NEW — notes + asserts now carry the validation requirement; stale blockedBy prose dropped from JOB-NEW notes (gate already open).

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none — ship commit `4ae3817` already flipped JOB-NEW open; remaining blockedBy chain intact.

## Queue (7)

Head: **JOB-FANOUT-PATH** (open) and **JOB-NEW** (open) — file-disjoint, can fan out together. Then serial: RUN → RM → STATUS → EXTRACT → DOCS, unblocking mechanically as tags ship.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (new JOB-FANOUT-PATH entry; JOB-NEW notes/asserts routing) and `.flume/plan/state.md`; open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `4ae3817` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 8 of origin/main** — human push pending.

Plan continues: no
