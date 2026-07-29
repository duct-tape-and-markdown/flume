# State

Phase: **v0.7 line in flight** — `EXIT-CODE-CONTRACT-COUNTS` shipped
this pass (`7adbdc8`, after retry `b37d172`); 5 entries in
`pending.json`. Mode this tick: **audit** (2 commits since the last
`plan:` commit `28b967e` — `b37d172`, `7adbdc8` — the only non-empty
dimension; inbox empty, no spec changes, no `blockedBy` gates to
promote).

## This tick (audit)

Verified the delta directly (`git log --oneline 28b967e..HEAD`,
`git diff 28b967e..HEAD -- spec/`, `.flume/inbox.md` contents) rather
than trusting the harness's own probes, which again failed to execute
in this tick's `<last-plan>`/`<spec-delta>` blocks (wrong shell).

**Audit** — cross-checked `b37d172` (build retry that finally shipped
`EXIT-CODE-CONTRACT-COUNTS`, `7adbdc8` its mechanical ship-commit)
against §4's 2026-07-29 amendment in full:

- `writeTickCounts`/`clearTickCounts`/`readTickCounts` +
  `TickCountsRecord` (`src/Dispatcher.ts`) correctly implement the
  disk-boundary contract: child stdio stays `inherit`, one JSON file
  per `<flumeDir>`, cleared before each real tick, written only when
  `outcome.result` exists (never on chain-load-failure/hibernation/
  terminal-misconfig — matches its own doc comment).
- `SuperviseResult.shippedTags`/`erroredTicks` accumulate correctly
  across iterations in `superviseLoop`, on every return path
  (terminal, mount-dead, hibernated, `--max`-reached).
  `loopExitCode`/`loopCompletionSummary` (`src/cli.ts`) match the
  ruled contract exactly: non-zero iff `erroredTicks.length > 0 &&
  shippedTags.length === 0`; summary prints whenever `erroredTicks`
  is non-empty, regardless of exit code.
- `errored` scoping (`gate-revert` / `platform-preempt`, excluding
  `voluntary-bail`) matches `collaboration.md`'s park-don't-decide
  norm — a clean decline isn't a failure.
- Declared-files fence: diff touches exactly
  `EXIT-CODE-CONTRACT-COUNTS`'s declared `files` (`src/Dispatcher.ts`,
  `src/cli.ts`, `CHANGELOG.md`, `tests/Dispatcher.test.ts`,
  `tests/cli.test.ts`) — no scope creep.
- Considered whether a fanout wave's per-entry gate-reverts go unheard
  when the wave also ships something (`committedWave` only sets
  `waveNoCommit` when `shipped.length === 0`, so `errored: false` is
  written even if some entries in the same wave reverted). Judged this
  **not a defect**: it's the pre-existing wave-level `noCommit`
  granularity (used by the tick's own log summary line since before
  this entry), consistent with "tick errored" meaning the tick
  produced nothing usable — a partial wave's un-shipped entries just
  stay pending for retry, same as any other tick. Accepted as-is, no
  entry filed.

**Line-reference drift** — `b37d172` inserted ~78 lines into
`src/Dispatcher.ts` (before line 234) and ~40 into `src/cli.ts`
(before line 515), staling three already-filed entries' `~L`
pointers. Corrected in `pending.json` this tick (mechanical, no
behavior implied):
- `CJS-CONTEXT-REFUSAL`: `loadChainModule` `234-274` → `313-353`;
  also dropped the entry's now-stale "blocked on EXIT-CODE-CONTRACT"
  notes framing (that entry shipped last pass; `gate.kind` was
  already correctly `open`).
- `EXIT-CODE-CONTRACT-DOC-DRIFT`: the stale-comment pointer
  `~L492-499` → `~L577`; also widened its `docs/CLI.md` ask —
  `loop`/`job run` sections now also predate the shipped COUNTS
  partial-success/errored-nothing-shipped contract, not just
  `EX_MOUNT_DEAD`. Folded into the existing entry rather than a
  second follow-up (operator ruling against `-TESTS`-style
  fragmentation applies equally to doc-drift fragmentation).
- `BAY-DISCOVERY-WALKUP`: `repoRoot = process.cwd()` `~L515` →
  `~L570`.
- Checked `ENGINE-PIN-HANDSHAKE`'s `readPackageVersion` cite
  (`~L53-60`) and `SETUP-WORKTREE-HELPER`'s file cites — all outside
  `b37d172`'s insertion points, unaffected.

Also confirmed, in passing: `.flume/loop.pid` still names pid `26692`
(unchanged from last pass) — same live supervisor, no second-process
signal; `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` untouched.

**Derive** — `git diff 28b967e..HEAD -- spec/` empty; not triggered.

**Drain** — `inbox.md` confirmed header-only; not triggered.

**Promote** — checked all 5 `pending-now` entries: none has
`gate.kind: "blockedBy"`. No-op.

## Queue (5)

1. `CJS-CONTEXT-REFUSAL` — open.
2. `EXIT-CODE-CONTRACT-DOC-DRIFT` — open (scope widened this tick).
3. `BAY-DISCOVERY-WALKUP` — open.
4. `ENGINE-PIN-HANDSHAKE` — open.
5. `SETUP-WORKTREE-HELPER` — open.

## Open questions (4)

Unchanged this pass — none touched:
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT
  (2 of 3 asks).

## Writable-paths / trunk

- `pending.json`: 5 entries; `EXIT-CODE-CONTRACT-COUNTS` removed
  (shipped by `7adbdc8`); three entries' line-reference pointers
  corrected, one entry's `docs/CLI.md` ask widened, one entry's stale
  notes reworded — no tags added or removed beyond the ship.
- `state.md`: rewritten this tick.
- `open-questions.md`: untouched (no new questions, none resolved).
- `inbox.md`: untouched (already empty).
- Trunk: HEAD `7adbdc8` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact,
  not a plan concern).

Plan continues: no
