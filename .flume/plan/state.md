# State

Phase: **v0.6.2 line in flight** — `spec/RELEASE-v0.6.2.md` (friction
lifecycle + win32 teardown fallback). `pending.json` holds 2 entries:
`FRICTION-SURFACING-TESTS` (open, next) → `CHANGELOG-0-6-2` (open,
unblocked, unchanged). Mode this tick: **audit** (commit-delta was the
only live dimension; real gap found and filed).

## This tick

- `git log --grep='^plan:' -n 1` → `19acf24` (prior plan tick). Two
  commits since: `eb6e076` (build: surface friction counts on
  status/loop/job-status per §6) and `15a1d89` (chore(flume): ship
  FRICTION-SURFACING — mechanical pending.json entry removal, not
  plan-authored). **Audit**: triggered on `eb6e076`.
- `git diff 19acf24..HEAD -- spec/` → empty (bootstrap script failed on
  this shell but the commit list confirms no `spec/` path touched).
  **Derive**: not triggered.
- `.flume/inbox.md` → header-only. **Drain**: not triggered.
- `pending.json`'s prior `blockedBy` chain had already resolved: the
  chore commit flipped `CHANGELOG-0-6-2` from `blockedBy FRICTION-
  SURFACING` to `open` when `FRICTION-SURFACING` shipped. **Promote**:
  nothing left to flip this tick.

**Audit of `eb6e076`** (FRICTION-SURFACING): cross-checked the diff
against §6 directly and against the entry's own `files.edit`/`tests[]`/
`acceptance`.

- `git show eb6e076 --stat` → exactly the three declared `files.edit`
  paths (`src/Dispatcher.ts`, `src/cli.ts`, `src/job.ts`) — no scope
  creep.
- Mechanics read correct against §6: `frictionCountLine` (Dispatcher.ts)
  shared by `flume status` and the loop-end summary; `jobStatus`'s new
  `frictionDir` param and per-job `frictionCount` for `job status`;
  `jobExtract`'s `readFrictionFiles` reads the friction dir off the job
  dir's *working tree* (not `git show` — friction is gitignored, never
  reaches a commit) and appends `{path, content}` entries after the
  chain-declared harvest, exactly the existing harvest shape. Also
  fixed, correctly: the `loop` subcommand never threaded `configDir`
  into `superviseLoop`, so a job run under `FLUME_CONFIG_DIR` would
  have summarized the wrong chain's friction — now plumbed through.
  `pnpm tsc --noEmit` clean.
- **Real gap, same shape as the three prior recurrences**
  (`FRICTION-DECLARATION-TESTS`, `FRICTION-GITIGNORE-TESTS`,
  `FRICTION-REVERT-NOTE-TESTS`): the entry's `tests[]` named
  `tests/cli.test.ts` and `tests/job.test.ts` but never listed them
  under `files.edit`, so the entry-scoped write guard excluded them —
  `eb6e076` touched only `src/`. Confirmed via grep: zero references to
  `frictionCountLine`, `frictionCount`, `readFrictionFiles`, or
  `countFrictionFiles` anywhere in `tests/*.ts`. This recurrence is
  also wider than the prior three: the original entry's `tests[]` never
  named `superviseLoop`'s loop-end summary or the `configDir` plumbing
  fix at all, so that surface has no test path even in the drafted
  intent — a missed case, not just an unlisted one.
- **Filed `FRICTION-SURFACING-TESTS`** (open, head of queue) with all
  three test paths explicit under `files.edit` this time:
  `tests/cli.test.ts` (status/job-status friction line), `tests/job.test.ts`
  (extract's fs-based friction harvest), `tests/Dispatcher.test.ts`
  (`superviseLoop`'s loop-end summary at both stop paths, plus the
  `configDir` regression case). `CHANGELOG-0-6-2` stays `open` and
  second in the array (priority ordering, not a gate block) — the
  CHANGELOG content itself is accurate regardless of test-coverage
  debt on the feature it describes.

## Queue (2)

`FRICTION-SURFACING-TESTS` (open, next) → `CHANGELOG-0-6-2` (open,
second by array order). No `blockedBy` between them; ordering reflects
priority only.

## Open questions (3)

Unchanged this tick — no new information surfaced against any of them:
engine-ownership requests (5 items, awaiting a v0.7 scoping call),
CLI-through-a-junction silent-exit, and the harness-block fence-mismatch.

## Writable-paths / trunk

- Wrote `.flume/plan/pending.json` (filed `FRICTION-SURFACING-TESTS`,
  reordered `CHANGELOG-0-6-2` second) and `.flume/plan/state.md` this
  tick. No spec change to derive, no inbox to drain.
  `open-questions.md` and `inbox.md` untouched (identical to `HEAD`).
- Trunk: HEAD `15a1d89` at tick start, tree clean besides untracked
  `.flume/loop.pid` (unwritable runtime path, left alone).

Plan continues: no
