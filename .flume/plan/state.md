# State

Phase: **v0.7 line in flight** — `EXIT-CODE-CONTRACT` shipped
(`92f3e56`); 6 entries in `pending.json` (5 carried + 1 new this
pass). Mode this tick: **audit** (2 commits since the last `plan:`
commit `f2eeb55` — `3a8d75e` build + `92f3e56` chore-ship of
`EXIT-CODE-CONTRACT` — the only non-empty dimension; inbox empty, no
spec changes, promote already resolved mechanically by the ship
commit).

## This tick (audit only)

Verified the delta directly before trusting the harness's
`<commit-delta>`/`<inbox>` blocks (per the prior tick's logged
false-empty-delta incident): `git log --oneline -8`, `wc -l` on
`inbox.md`/`pending.json` confirm 2 commits since `f2eeb55` and a
truly empty inbox (header-only).

**Audit** — cross-checked `3a8d75e` (build EXIT-CODE-CONTRACT) against
§4 line by line:
- `EX_MOUNT_DEAD` (69, sibling to `EX_TERMINAL_MISCONFIG`) is
  correctly distinct from generic harness-error 1; `tickExitCode`'s
  mapping is safe because `TickOutcome.failed` is set at only the one
  chain-resolution-throw site (`Dispatcher.ts:512`), never for a
  plain per-entry agent failure — ordinary tick failures are
  unaffected, matching §4's "tick-level agent failures keep today's
  semantics" clause.
- `superviseLoop` fail-fasts on `EX_MOUNT_DEAD` exactly as on
  `EX_TERMINAL_MISCONFIG`; `cli.ts`'s loop exit mapping and both
  `--help` blocks (tick, loop) updated to match; three test files
  (`Dispatcher.test.ts`, `cli.test.ts`, new integration case) cover
  the abort-after-one-tick shape end-to-end. The two locked-assertion
  rewrites match the amendment's explicit authorization.
- **Found real drift**: the commit updated the `TickOutcome.failed`
  JSDoc and the `superviseLoop` doc comment for the new abort
  behavior, but missed a third spot — the inline comment at
  `Dispatcher.ts:492-499` still reads "the supervisor logs and
  proceeds… every subsequent tick fails the same way", exactly the
  pre-§4 behavior this commit killed. Same gap in `docs/CLI.md`
  (tick/loop/job-run sections, ~L30/38/96): still documents only exit
  1 for chain/harness failure, no mention of 69. Neither file was in
  the original `EXIT-CODE-CONTRACT` entry's declared `files` (an
  under-declaration, not a build lapse — the fanout write guard would
  have reverted the edit had build attempted it). Filed as
  `EXIT-CODE-CONTRACT-DOC-DRIFT` (doc/comment-only, no behavior
  change, no test needed).
- `92f3e56` (ship) is mechanical and correct: only `pending.json`
  touched, entry removed, both `blockedBy EXIT-CODE-CONTRACT` entries
  already flipped to `open` in that same commit — nothing left for
  this tick's promote pass.

**Derive** — no spec changes since `f2eeb55`; not triggered.

**Drain** — `inbox.md` confirmed empty (header-only); not triggered.

**Promote** — checked: no entry in `pending-now` has
`gate.kind: "blockedBy"` naming a tag absent from `pending-now`.
No-op.

## Queue (6)

1. `EXIT-CODE-CONTRACT-COUNTS` — open.
2. `CJS-CONTEXT-REFUSAL` — open.
3. `EXIT-CODE-CONTRACT-DOC-DRIFT` — open, new this pass.
4. `BAY-DISCOVERY-WALKUP` — open.
5. `ENGINE-PIN-HANDSHAKE` — open.
6. `SETUP-WORKTREE-HELPER` — open.

## Open questions (4)

Unchanged this pass — none touched:
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT
  (2 of 3 asks).

## Writable-paths / trunk

- `pending.json`: +1 entry (`EXIT-CODE-CONTRACT-DOC-DRIFT`), inserted
  third; all other entries unchanged.
- `state.md`: rewritten this tick.
- `open-questions.md`: untouched (no new questions, none resolved).
- `inbox.md`: untouched (already empty).
- Trunk: HEAD `92f3e56` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (runtime artifact, not a plan concern).

Plan continues: no
