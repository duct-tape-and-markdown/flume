# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit JOB-RUN ship

Delta = 1 build commit + 1 chore ship (`cd25077`, `a0e5edf`); no spec changes; inbox empty.

**Audit `cd25077` (JOB-RUN vs §5b)**: clean. Scope = the five declared files exactly. §5b-1: branchExists assert → JobUsageError exit 2 on missing branch (unit proves neither HEAD nor state root mutated on refusal); checkout only when HEAD elsewhere — inside the §6 worktree the assert passes with no checkout (integration asserts "on job/itest"). §5b-2: Baton check precedes chain load, and the chain loads AFTER checkout (chain.ts lives on the job branch — ordering is correct); two-phase test chain proves the wake targets phases[0] by position, not name; mid-job baton untouched; re-run idempotent. §5b-3 is the standard loop **by construction**: CLI rewrites `job run <name>` → `--job <name> loop` and falls through (src/cli.ts:381-408), preflight placed after resolveStateDirs (resolution conflict refuses before any mutation) and before the wrong-branch guard, which the checkout satisfies (src/cli.ts:436-453). Integration runs the §6 recipe verbatim (`.git/flume-jobs/<name>` linked worktree), proves child-tick env inheritance (FLUME_DIR/CONFIG_DIR/JOB rooted in the worktree), and lock refusal leaves the holder's pidfile intact. Edge sweep: `job run --help` caught by wantsHelp before run parsing; `--job x` vs `job run y` conflict exits 2, same-name composes; env `FLUME_JOB` vs run name resolves flag-wins (conventional explicit-beats-ambient; spec silent; same precedence as `--job` vs env — fine).

**Findings**: none filed. Two one-line debt observations: (1) preflight wake lands before the loop takes `loop.pid`, so a lock-refused `job run` leaves the entry phase woken — benign (retry resumes "mid-job" into the same phase; §6 accepted-race posture). (2) leading-dash names pass validateJobName (`job run -x` → exit 2 "branch job/-x does not exist") — same class as jobNew's existing gap, single-operator CLI, trivial.

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none — the ship commit already flipped JOB-RM to open; remaining blockedBy chain (STATUS → EXTRACT → DOCS) intact in pending.

## Queue (4)

Head: **JOB-RM** (open). Serial after: STATUS → EXTRACT → DOCS, unblocking mechanically as tags ship.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json unchanged (queue as shipped-minus-head already correct); open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `a0e5edf` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 18 of origin/main** — human push pending.

Plan continues: no
