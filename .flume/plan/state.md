# State

Phase: **v0.5 ACTIVE** (`spec/RELEASE-v0.5.md`; v0.1–v0.4 frozen). Mode this tick: **audit**.

## This tick — audit TRUNK-PURGE + JOB-RESOLUTION ship

Delta = 2 build commits + 1 chore ship (`0183c81`, `5242634`, `36b1a93`); no spec changes; inbox empty.

**Audit `0183c81` (TRUNK-PURGE vs §2)**: clean. Exactly the four cited deletion sites removed from `src/Dispatcher.ts`; both §7 tests landed (type-level `TrunkBranchPurged`, ship-follows-HEAD with left-behind branch pinned unmoved). open-questions.md write is the sanctioned channel (tests-typecheck question, still parked). No drift, no scope creep.

**Audit `5242634` (JOB-RESOLUTION vs §3)**: clean. Flag+explicit-dirs → exit 2 naming the vars; env `FLUME_JOB` composes with explicit dirs — conforming: §3 names only the flag as the usage error, and strict-conflict would break loop→tick write-back inheritance (child would classify its own inherited vars as conflict). Guard on tick/loop only (incl. bare-`flume`→tick default), exit 1 naming both branches, read-only verbs skip, per-subcommand `--help` short-circuits before guard. Test surface covers every planned assert + env-compose semantics. Scope matches declared files.

**Accepted debt**: `--job` doesn't validate name shape (`a/b` → nested jobdir, branch `job/a/b`); validation belongs where names are created — `job new` §5a (JOB-NEW should cover it).

**Derive**: none (no spec delta). **Drain**: none (inbox empty). **Promote**: none — ship commit `36b1a93` already flipped JOB-FANOUT-NS to open; remaining blockedBy chain intact.

## Queue (7)

Head: **JOB-FANOUT-NS** (open). Then serial: NEW → RUN → RM → STATUS → EXTRACT → DOCS, unblocking mechanically as tags ship.

## Active plan target

`spec/RELEASE-v0.5.md` — decomposition complete; underived surface: none. Next derivation trigger: v0.5 amendments or a v0.6 file.

## Open questions

**1** — type-level tests not gate-enforced (tsconfig excludes `tests/`); PARKED, options captured, human toolchain call.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only; pending.json unchanged (no delta to derive, head already open); open-questions.md unchanged; inbox.md untouched (empty).
- Trunk: HEAD `36b1a93` at tick start, tree clean (untracked `.flume/loop.pid` is runtime). **main ahead 5 of origin/main** — human push pending.

Plan continues: no
