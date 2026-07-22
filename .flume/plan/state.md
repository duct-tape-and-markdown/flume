# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit JOB-FANOUT-PATH + JOB-NEW ships

Delta = 2 build commits + 1 chore ship (`ff184df`, `25279a3`, `63d550b`); no spec changes; inbox empty.

**Audit `ff184df` (JOB-FANOUT-PATH vs §4)**: clean. Path derivation mirrors branch namespacing exactly as filed (`src/Dispatcher.ts:1119`); scope = the two declared files. All three path asserts present (tests/Dispatcher.test.ts:1010+), including a live-worktree interleave proving job B's stale-cleanup no longer rm's job A's live worktree, and the legacy no-namespace path (:1159).

**Audit `25279a3` (JOB-NEW vs §5a)**: conforming on all seven steps; scope = the four declared files exactly; every entry assert present (baseline excludes runtime+junction, ignore-ensure idempotent + template-preserving, no-dep-tree link fixture via injectable linkTarget seam, template-less warn, separator name exit 2). Porcelain kept local to src/job.ts as the entry declared.

**Findings → filed JOB-NEW-SCOPE** (open, per §5a): (1) step-6 `git commit` carries no pathspec — pre-staged foreign index content gets swept into the seed commit, exceeding "baseline-commit the seeded harness"; (2) `--template` check is existsSync-only — a file passes, cp fails exit 1 raw, while docs/CLI.md promises exit 2 for "no directory". Both mechanical; one entry, src/job.ts + tests/job.test.ts.

**Accepted debt**: single-segment job names that are invalid git ref components (`a..b`, `x.lock`, `~^:` chars) surface as loud exit-1 checkout failures, not exit-2 usage errors — git ref grammar stays git's to enforce (noted in commit body).

**Gate shape**: JOB-NEW-SCOPE sits open at head alongside JOB-RUN (open) despite overlapping src/job.ts + tests/job.test.ts — `partitionByFileOverlap` (`src/Dispatcher.ts:611`) batches overlapping entries and runs batch 1 only, so the harness serializes them; no blockedBy needed.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none — every blockedBy tag still in pending.

## Queue (6)

Head: **JOB-NEW-SCOPE** (open), then **JOB-RUN** (open, overlap-partitioned to the next wave). Serial after: RM → STATUS → EXTRACT → DOCS, unblocking mechanically as tags ship.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (JOB-NEW-SCOPE inserted at head) and `.flume/plan/state.md`; open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `63d550b` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 12 of origin/main** — human push pending.

Plan continues: no
