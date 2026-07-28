# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `FRICTION-DECLARATION` shipped
(`d009f19`, chore-removed from pending by `30cf7cf`). `pending.json` now
holds 6 entries. Mode this tick: **audit** (commit-delta was the only live
dimension; drain/derive/promote all no-ops — see below).

## This tick

Verified directly (the harness's own delta-computation `exec` calls failed
again this tick — same `/usr/bin/bash` absence as last tick — so `git` was
re-run manually to confirm the delta):

- `git log --grep='^plan:' -n 1` → `20cf7409`. Two commits since:
  `d009f19` (build: FRICTION-DECLARATION) and `30cf7cf` (chore(flume):
  ship FRICTION-DECLARATION — mechanical pending.json removal + promotion
  of `FRICTION-GITIGNORE` to `open`, not a plan-authored commit).
  **Audit**: triggered on `d009f19`.
- `git diff 20cf7409..HEAD -- spec/` → empty. **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s `blockedBy` tags (`TEARDOWN-HARDENING` →
  `FRICTION-GITIGNORE`, `FRICTION-REVERT-NOTE` → `TEARDOWN-HARDENING`,
  `FRICTION-SURFACING` → `FRICTION-REVERT-NOTE`, `CHANGELOG-0-6-2` →
  `FRICTION-SURFACING`) all reference tags still present in the array —
  none unblocked this tick. `FRICTION-GITIGNORE` was already promoted to
  `open` by the `30cf7cf` chore commit before this tick started.
  **Promote**: not triggered (already current).

**Audit of `d009f19`** (FRICTION-DECLARATION): read the shipped
`validateFrictionDeclaration` in `src/Dispatcher.ts` and the `friction?:
string` field on `src/Phase.ts`'s `Chain` against §2. Matches: relative-
path check, resolves-inside-state-root check via a base-independent
sentinel-root comparison, wired into the single `loadChainModule` load
path, undeclared is a strict no-op. No spec drift, no scope creep beyond
`entry.files` (`src/Phase.ts` + `src/Dispatcher.ts` only, as declared).

One real gap, already diagnosed in `open-questions.md` last tick as
**NEEDS AMENDMENT**: the entry's own `tests[].path`
(`tests/Dispatcher.test.ts`) was never added to `entry.files.edit`, so the
entry-scoped write guard excluded it and the commit shipped with manual
verification only, no committed test. That diagnosis already carried a
clear fix shape (list the test path under `files.edit` explicitly) — per
`collaboration.md`'s "inform before parking," a clear-answer finding
doesn't get re-parked, it gets filed. Routed this tick as a new pending
entry, **`FRICTION-DECLARATION-TESTS`** (`gate: open`, head of queue,
`tests/Dispatcher.test.ts` under `files.edit`), and the now-resolved
open-question section removed from `open-questions.md`.

`30cf7cf` (the chore commit) is a mechanical pending.json diff (entry
removal + gate promotion) with no source changes — nothing to audit
beyond confirming it's internally consistent, which it is.

## Queue (6)

`FRICTION-DECLARATION-TESTS` (open, new this tick) → `FRICTION-GITIGNORE`
(open) → `TEARDOWN-HARDENING` → `FRICTION-REVERT-NOTE` →
`FRICTION-SURFACING` → `CHANGELOG-0-6-2`. Two entries are now
build-ready (`open`): the new test-coverage entry and `FRICTION-GITIGNORE`
(unblocked by `FRICTION-DECLARATION`'s shipment, promoted by the chore
commit prior to this tick). Build can take either next.

## Open questions (3)

Down from 4: the `FRICTION-DECLARATION` test-fence NEEDS AMENDMENT item
resolved into `FRICTION-DECLARATION-TESTS` above and was removed. Still
parked, untouched this tick: engine-ownership requests (5 items now,
awaiting a v0.7 scoping call), CLI-through-a-junction silent-exit, and the
harness-block fence-mismatch (the same root cause as the item just
resolved, but at the *harness-authoring* level rather than one entry —
still needs a human call on what the corrected `<harness>` block should
render).

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (new entry prepended, rest unchanged),
  `.flume/plan/open-questions.md` (one resolved section removed), and
  `.flume/plan/state.md` (this file). Did not touch `inbox.md` (nothing to
  drain), `spec/`, or `src/`.
- Trunk: HEAD `30cf7cf` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
