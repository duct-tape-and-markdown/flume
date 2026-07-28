# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `pending.json` holds 3 entries:
`FRICTION-REVERT-NOTE-TESTS` (open, next) → `FRICTION-SURFACING` (open) →
`CHANGELOG-0-6-2` (blockedBy `FRICTION-SURFACING`). Mode this tick:
**audit** (commit-delta was the only live dimension; it surfaced a real
gap — FRICTION-REVERT-NOTE shipped with no test coverage).

## This tick

- `git log --grep='^plan:' -n 1` → `5793b18` (prior plan tick). Two
  commits since: `b128717` (build: write §5 revert notes to the
  friction channel, FRICTION-REVERT-NOTE) and `a5de3d6`
  (chore(flume): ship FRICTION-REVERT-NOTE — mechanical pending.json
  entry removal, not plan-authored). **Audit**: triggered on `b128717`.
- `git diff 5793b18..HEAD -- spec/` → empty. **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s `blockedBy` chain: `FRICTION-REVERT-NOTE` no longer
  present in `pending-now` (shipped, removed by `a5de3d6`, which also
  already flipped `FRICTION-SURFACING`'s gate from `blockedBy` to
  `open`). `CHANGELOG-0-6-2` → `FRICTION-SURFACING` still references a
  tag present in `pending-now`. **Promote**: nothing left to flip.

**Audit of `b128717`** (FRICTION-REVERT-NOTE): cross-checked the diff
against §5 and against the entry's own `files.edit`/`tests[]`/
`acceptance`.

- `git show b128717 --stat` → exactly the one declared path
  (`src/Dispatcher.ts`, 85 insertions) — no scope creep past
  `files.edit`.
- `writeRevertNote`/`capturedCommitMessage` (src/Dispatcher.ts
  ~1451-1520), called from `runFanoutEntry`'s afterCommit revert branch
  (~1033-1039), match §5: runs *before* `git.dropLastCommit` (sha still
  reachable), writes `<friction>/<ISO>--<tag>--reverted.md` with gate
  name/message/details + reverted commit subject+body, no-ops when
  `chain.friction` is undeclared, and a write failure logs without
  blocking the revert.
- Checked whether scoping this to `runFanoutEntry` only (not
  `runSingleton`'s afterCommit revert branch at ~564-590, used by
  singleton phases like this repo's own `plan`) is a missed case: it
  isn't. §5's own framing ("today that evidence dies with the
  worktree") and §1's blast radius are both about fanout worktree
  teardown; `runSingleton` has no worktree to tear down and already has
  its own unrelated durability mechanism (`snapshotRevertedFiles`, §8).
  No open question filed.
- **Gap found**: zero test coverage. `tests/Dispatcher.test.ts` has no
  case exercising `writeRevertNote`/"reverted.md" for this feature —
  confirmed by grep and by running the suite (64/64 pass, none of them
  new for §5). The entry's own `tests[]` promised
  `tests/Dispatcher.test.ts`, but `files.edit` was src-only, so the
  fanout writablePaths guard would have reverted any same-tick test
  addition — the build commit's own body says as much. This is the
  fourth occurrence of the exact defect closed three times already this
  line (`FRICTION-DECLARATION-TESTS`, `FRICTION-GITIGNORE-TESTS`,
  `TEARDOWN-HARDENING-TESTS`): all four v0.6.2 sections were derived in
  one batch (`443aa1a`) sharing the same authoring gap, and this was the
  last of the four to come up in the build queue.
- Ran the gates myself: `pnpm tsc --noEmit` clean; `pnpm vitest run
  tests/Dispatcher.test.ts` — 64/64 pass (no regression; no new §5
  coverage, consistent with the gap above).
- Routed: filed `FRICTION-REVERT-NOTE-TESTS` in `pending.json`, same
  shape as the three prior `*-TESTS` follow-ups, `files.edit` naming
  `tests/Dispatcher.test.ts` explicitly this time. Placed at the head of
  the queue (open, no blocker) — same precedent as
  `TEARDOWN-HARDENING-TESTS`, which didn't block sibling feature work.

`a5de3d6` (the chore commit) is a mechanical pending.json diff (one
entry removed, one gate flipped open) — internally consistent with the
shipped work, nothing further to audit.

## Queue (3)

`FRICTION-REVERT-NOTE-TESTS` (open, next) → `FRICTION-SURFACING` (open)
→ `CHANGELOG-0-6-2` (blockedBy `FRICTION-SURFACING`). The test-coverage
follow-up leads; `FRICTION-SURFACING` remains independently buildable
since it doesn't touch the revert-note code path.

## Open questions (3)

Unchanged this tick — no new information surfaced against any of them:
engine-ownership requests (5 items, awaiting a v0.7 scoping call),
CLI-through-a-junction silent-exit, and the harness-block fence-mismatch.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (prepended `FRICTION-REVERT-NOTE-TESTS`,
  removed the shipped `FRICTION-REVERT-NOTE`, left `FRICTION-SURFACING`
  and `CHANGELOG-0-6-2` byte-identical) and `.flume/plan/state.md` this
  tick. No spec change to derive, no inbox to drain. `open-questions.md`
  and `inbox.md` untouched (identical to `HEAD`).
- Trunk: HEAD `a5de3d6` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
