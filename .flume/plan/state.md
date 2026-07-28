# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `pending.json` holds 3 entries:
`FRICTION-REVERT-NOTE` (open, next) → `FRICTION-SURFACING` →
`CHANGELOG-0-6-2` chained behind it in shipping order. Mode this tick:
**audit** (commit-delta was the only live dimension; it came back clean
— the debt filed last tick is now closed with no new gaps).

## This tick

- `git log --grep='^plan:' -n 1` → `d6c9962` (prior plan tick). Two
  commits since: `cbccc5a` (build: cover teardown harvest + win32
  removal fallback, TEARDOWN-HARDENING-TESTS) and `a6d989c`
  (chore(flume): ship TEARDOWN-HARDENING-TESTS — mechanical
  pending.json entry removal, not plan-authored). **Audit**: triggered
  on `cbccc5a`.
- `git diff d6c9962..HEAD -- spec/` → empty. **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s `blockedBy` chain: `TEARDOWN-HARDENING-TESTS` no
  longer present in `pending-now` (shipped, removed by `a6d989c`).
  `FRICTION-REVERT-NOTE` is `open` (was never blocked on it — see prior
  tick's queue note: it could build in either order).
  `FRICTION-SURFACING` → `FRICTION-REVERT-NOTE` and `CHANGELOG-0-6-2` →
  `FRICTION-SURFACING` both still reference tags present in
  `pending-now`. **Promote**: not triggered.

**Audit of `cbccc5a`** (TEARDOWN-HARDENING-TESTS): cross-checked the
diff against §4 (harvest) and §7 (win32 removal fallback) and against
the entry's own `files.edit`/`tests[]`/`acceptance`.

- `git show cbccc5a --stat` → exactly the three declared paths
  (`src/Dispatcher.ts`, `tests/Dispatcher.test.ts`, `tests/git.test.ts`)
  — no scope creep past `files.edit`.
- `tests/Dispatcher.test.ts` covers §4 e2e via `dispatcher.tick()`:
  happy-path move (tag-prefixed, pre-removal), a per-file failure that
  logs and still ships the wave, an unreadable mirror dir (logged, not
  swallowed — closes last tick's second gap), undeclared
  `chain.friction` no-op, relocated state root no-op. All five map
  directly to the entry's `tests[]` asserts.
- `tests/git.test.ts` covers §7's `removeWorktree`: bare remove
  succeeds, prune+bounded-retry fallback clears a populated tree the
  bare call refused, and a still-surviving path (forced via a partial
  `fs/promises` mock on `rm`) throws naming the path — matches §7
  bullets 1–2 and the entry's asserts exactly.
- `src/Dispatcher.ts`'s `readdir` catch now distinguishes `ENOENT`
  (silent) from anything else (logged) — the unreadable-dir gap from
  last tick's audit is closed.
- Ran the gates myself: `pnpm tsc --noEmit` clean;
  `pnpm vitest run tests/git.test.ts tests/Dispatcher.test.ts` — 72/72
  pass (3 new `removeWorktree` cases + 5 new harvest cases, plus the
  full existing Dispatcher suite still green).
- No new gap found. `TEARDOWN-HARDENING` (a94767e, src-only) now ships
  with the coverage its own entry always promised; the
  FRICTION-DECLARATION-TESTS/FRICTION-GITIGNORE-TESTS/
  TEARDOWN-HARDENING-TESTS defect pattern (entry names `tests[]`, guard
  only enforces `files.edit`) does not recur here — this entry listed
  both test paths explicitly and the build tick honored them.

`a6d989c` (the chore commit) is a mechanical pending.json diff (one
entry removed) — internally consistent with the shipped work, nothing
further to audit.

## Queue (3)

`FRICTION-REVERT-NOTE` (open, next) → `FRICTION-SURFACING` →
`CHANGELOG-0-6-2`, chained behind it in shipping order. All prior
teardown-hardening debt is now closed — this is a clean two-entry
build-ready state plus its CHANGELOG follow-up.

## Open questions (3)

Unchanged this tick — no new information surfaced against any of them:
engine-ownership requests (5 items, awaiting a v0.7 scoping call),
CLI-through-a-junction silent-exit, and the harness-block fence-mismatch.

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` this tick (audit findings; no pending
  entries added or changed). No spec change to derive, no inbox to
  drain, no promote needed. `pending.json`, `open-questions.md`, and
  `inbox.md` untouched (identical to `HEAD`).
- Trunk: HEAD `a6d989c` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
