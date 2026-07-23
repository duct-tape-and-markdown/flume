# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit JOB-RM ship

Delta = 1 build commit + 1 chore ship (`64079c1`, `e539a1f`); no spec changes; inbox empty.

**Audit `64079c1` (JOB-RM vs §5c)**: clean. Scope = the five declared files exactly. §5c-1: pid refusal runs before checkout (live loop implies branch is HEAD somewhere — switching under it is the race the refusal prevents); same liveness probe as the loop lock, dead/garbage pid reclaimed silently; pidPath `join(jobDir, "loop.pid")` matches the loop lock's `join(flumeDir, "loop.pid")` under job resolution (src/cli.ts:570 vs src/job.ts:336). Refusal unit proves dir, pidfile, history, branch all untouched; CLI test proves exit 1. §5c-2: checkout only when HEAD elsewhere; branchless-dir (half-created job) cleans up on current HEAD; `git rm` + commit both pathspec-scoped to the job dir — rm3 unit proves pre-staged foreign file stays staged and out of the cleanup commit; untracked sweep via fs.rm unlinks the @dtmd/flume junction without following (unit asserts PACKAGE_ROOT intact — runs on this win32 host, so the junction path itself is exercised); worktree prune runs. §5c-3: branch + full history survive (cleanup at tip, seed beneath), main untouched; re-run on clean job is exit-0 no-op. Integration: new→run(tick)→rm e2e green incl. runtime-remnant sweep. Exit-code table (0/1/2) consistent across code, tests, CLI.md.

**Findings**: none filed. Three one-line debt notes: (1) rm from the primary checkout can't see a live loop running in a §6 linked worktree (pidfile lives in the worktree's state root) — backstopped by git's "branch is checked out" refusal on the checkout step, exit 1, no mutation; CLI.md documents "run rm from inside that worktree". (2) `git rm` without `-f` refuses on locally-modified harness files → exit 1; conservative-safe, operator resolves. (3) garbage pidfile → NaN → treated stale → proceeds; same posture as the loop lock.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none — ship commit already flipped JOB-STATUS to open; EXTRACT → DOCS blockedBy chain intact (gate tags still in pending).

## Queue (3)

Head: **JOB-STATUS** (open). Serial after: EXTRACT → DOCS, unblocking mechanically as tags ship.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json unchanged (queue as shipped-minus-head already correct); open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `e539a1f` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 20 of origin/main** — human push pending.

Plan continues: no
