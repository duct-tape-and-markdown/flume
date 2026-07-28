# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `pending.json` holds 4 entries:
`TEARDOWN-HARDENING-TESTS` (open, next — filed this tick), then
`FRICTION-REVERT-NOTE` (open) → `FRICTION-SURFACING` →
`CHANGELOG-0-6-2` chained behind it in shipping order. Mode this tick:
**audit** (commit-delta was the only live dimension; it surfaced one
real gap, filed below).

## This tick

- `git log --grep='^plan:' -n 1` → `81bb42c` (prior plan tick). Two
  commits since: `a94767e` (build: harvest worktree friction and harden
  win32 teardown, TEARDOWN-HARDENING) and `066ea20` (chore(flume): ship
  TEARDOWN-HARDENING — mechanical pending.json entry removal, not
  plan-authored). **Audit**: triggered on `a94767e`.
- `git diff 81bb42c..HEAD -- spec/` → empty. **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s `blockedBy` chain: `FRICTION-REVERT-NOTE` was already
  flipped `blockedBy(TEARDOWN-HARDENING)` → `open` by the `066ea20` ship
  commit — verified consistent (`TEARDOWN-HARDENING` no longer present
  in `pending-now`). `FRICTION-SURFACING` → `FRICTION-REVERT-NOTE` and
  `CHANGELOG-0-6-2` → `FRICTION-SURFACING` both still reference tags
  present in `pending-now`. **Promote**: not triggered this tick beyond
  what the ship commit already did.

**Audit of `a94767e`** (TEARDOWN-HARDENING): read the diff in full
against §4 (harvest) and §7 (win32 removal fallback).

- §4 mechanics check out: `harvestFriction` resolves the worktree-local
  mirror (`worktreePath + stateRootRel + chain.friction`), moves each
  file into `<flumeDir>/<friction>/` prefixed `<tag>--`, no-ops on
  undeclared friction and on a relocated state root, and per-file
  move failures (including an EXDEV copy+drop fallback for
  cross-volume worktrees) log and continue rather than aborting the
  wave. Matches spec.
- §7 mechanics check out: `removeWorktree` falls back from a failed
  bare `git worktree remove --force` to `worktree prune` +
  `fs.rm`'s bounded-retry recursive removal, and a still-surviving path
  is aggregated by the caller and reported once for the whole wave (not
  once per worktree) — matches §7 bullet 2 exactly.
- **Real gap found**: the commit message says outright that a prior
  attempt (dangling commit `2135c50`) carried tests for both files but
  was reverted for touching `tests/Dispatcher.test.ts` and
  `tests/git.test.ts` outside the entry's declared `files.edit`
  (`src/Dispatcher.ts`, `src/git.ts` only) — the shipped `a94767e` went
  src-only. Confirmed via `git show a94767e --stat` (2 files touched)
  and `grep` over both test files (zero references to friction harvest
  or the removal fallback). `pnpm vitest run tests/git.test.ts
  tests/Dispatcher.test.ts` — 64/64 pass, none of them exercising this
  code. Same defect shape plan has now hit three times
  (FRICTION-DECLARATION-TESTS, FRICTION-GITIGNORE-TESTS, now this): an
  entry names required coverage under `tests[]` but the write-guard
  only honors `files.edit`, so a src-only ship leaves the field's
  promise unfulfilled. Filed `TEARDOWN-HARDENING-TESTS` (open, head of
  queue) with both test paths explicit under `files.edit` this time.
- **Second, smaller gap in the same read**: `harvestFriction`'s
  `readdir` catch (Dispatcher.ts:1183-1189) swallows *any* failure
  silently — but §4 pairs "locked file" and "unreadable dir" as two
  failure classes that must log-and-continue, not one silent one.
  Absent-dir (ENOENT, the common no-friction-this-tick case) is
  correctly silent; a genuinely unreadable dir (e.g. EACCES) currently
  gets the same silent treatment, which is a minor spec deviation — an
  operator has no way to learn harvest failed there. Bundled into
  `TEARDOWN-HARDENING-TESTS` (same function, same audit pass, small
  fix) rather than a separate entry.

`066ea20` (the chore commit) is a mechanical pending.json diff (one
entry removed, one gate promoted) — internally consistent with the
shipped work, nothing further to audit.

## Queue (4)

`TEARDOWN-HARDENING-TESTS` (open, next) → `FRICTION-REVERT-NOTE` (open)
→ `FRICTION-SURFACING` → `CHANGELOG-0-6-2`, chained behind it in
shipping order. Two entries are build-ready (`TEARDOWN-HARDENING-TESTS`,
`FRICTION-REVERT-NOTE`); the new entry doesn't block or get blocked by
`FRICTION-REVERT-NOTE` — either can build first — it's queued ahead per
the same-tick-followup precedent (FRICTION-GITIGNORE-TESTS).

## Open questions (3)

Unchanged this tick — no new information surfaced against any of them:
engine-ownership requests (5 items, awaiting a v0.7 scoping call),
CLI-through-a-junction silent-exit, and the harness-block fence-mismatch.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (filed `TEARDOWN-HARDENING-TESTS`)
  and `.flume/plan/state.md` this tick. No spec change to derive, no
  inbox to drain. `open-questions.md` and `inbox.md` untouched
  (identical to `HEAD`).
- Trunk: HEAD `066ea20` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
