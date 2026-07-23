# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit JOB-EXTRACT ship

Delta = 1 build commit + 1 chore ship (`5e8a531`, `c06d62d`); no spec changes; inbox empty.

**Audit `5e8a531` (JOB-EXTRACT vs §5e)**: faithful on all five steps. Scope = 5 of the 6 declared edit files (src/git.ts declared, deliberately untouched — job.ts keeps its own porcelain; allowlist, not creep). §7 §5e bullet fully covered: intake-first ordering asserted via commit-subject order, non-harness selection, clobber refusal, conflict unwind (job intact, retryable, no CHERRY_PICK_HEAD residue), harvest to stdout, branch + dir gone. Build's two spec-silent refusals (dirty tracked tree, live loop) accepted as machinery-safety invariants; exit-code mapping (refusals 1, usage-shaped 2) matches rm precedent.

**Finding filed — EXTRACT-WORKTREE-GUARD (pending, head)**: consume step collides with the §6 recipe. A recipe-run job keeps `job/<name>` checked out in `.git/flume-jobs/<name>` after its loop stops; `git branch -D` refuses branches checked out in any worktree, so extract from the main worktree fails at step 5 *after* all picks + harvest — harvest output lost (thrown before print), fully-picked clean branch strands, retry hits the clobber refusal. Extract from inside the recipe worktree works (fork moves it off `job/<name>` first). Fix: up-front refusal when `job/<name>` is checked out in a worktree other than the current one — same guard family build established; auto-removing the operator worktree rejected (clobbers operator work). Researched, not parked, per Inform-before-parking.

**Debt accepted** (commit body): (1) mixed harness+code commits are picked whole per spec, so they'd carry `.flume/jobs/<name>` paths onto the clean branch — fanout write discipline makes mixed commits not occur; revisit only if one appears. (2) `gitShowBlob` maps any git failure to "absent" — a transient git error at harvest prints "no friction.md" instead of failing; cosmetic.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none (ship commit already flipped JOB-DOCS to open).

## Queue (2)

Head: **EXTRACT-WORKTREE-GUARD** (open) — hardens the shipped verb's §6-recipe path. Then **JOB-DOCS** (open, last v0.5 section); independent, no blockedBy.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (new head entry) + `.flume/plan/state.md`; open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `c06d62d` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 26 of origin/main** at tick start (27 with this commit) — human push pending.

Plan continues: no
