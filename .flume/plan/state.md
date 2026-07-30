# State

Phase: **v0.7 line in flight** — 3 entries in `pending.json`, all
`gate.kind: "open"`. Mode this tick: **audit** (commit-delta since the
last `plan:` commit, `db645f5`, is 2 commits; no spec-delta, empty
inbox, nothing to promote).

## This tick

**Commit-delta** (`db645f5..HEAD`, 2 commits): `ac678ce` (build,
`IN-WORKTREE-GATE-REVERT-FOOTPRINT`), `14501f9` (chore, ship — entry
removed from `pending.json`).

- `ac678ce` cross-checked against §13 directly in source, not just the
  diff: `Dispatcher.ts`'s wave loop (`~L937-947`) now feeds a captured
  footprint into the same `observed` map the `afterMerge` path uses
  (`~L1022`), so `commitPendingUpdate` (`~L1075`) rides it onto trunk as
  `observedFiles` — verified the merge is literally the same map, not a
  parallel bookkeeping surface. `runFanoutEntry`'s gate-revert branch
  (`~L1277-1296`) captures `git.showNameOnly` before `dropLastCommit`
  discards the commit, mirroring the `afterMerge` capture technique
  exactly (full commit diff, not gate-details-filtered — same precedent,
  no new invariant invented). §13's parenthetical ("entry tag, gate
  name, gate message, and paths") reads as the full incident record
  (tag = map key, gate/message already lived in the pre-existing
  gitignored prior-attempt record); the acceptance line is scoped to
  paths reaching trunk, which this delivers — not drift, just a loosely
  worded spec gloss.
- Ran the new locked test directly (`vitest run tests/Dispatcher.test.ts
  -t "in-worktree afterCommit gate revert leaves the same trunk
  footprint"`) — passes. `CHANGELOG.md` bullet present and accurate.
  Diffstat matches declared files exactly (`src/Dispatcher.ts`,
  `CHANGELOG.md`, `tests/Dispatcher.test.ts`) — no scope creep.
  §13's orthogonal `entryChannelPaths` note (`tests/**`) already present
  in `.flume/chain.ts:261` from the prior operator commit — confirmed,
  no residual action.
- `14501f9`'s ship (declared-files diff touched, correctly cleared from
  `pending.json`) — no drift. §13 is now fully closed: both its
  derivable bullet (footprint machinery) and its operator-applied bullet
  (`prompts/build.md`, closed last tick) are shipped.

**Spec-delta**: none (`git diff db645f5..HEAD -- spec/` empty).

**Drain**: `.flume/inbox.md` confirmed header-only on disk — nothing to
route.

**Promote**: no entry in `pending-now` carries `gate.kind: "blockedBy"`
— nothing to flip.

## Queue (3)

1. `BAY-DISCOVERY-WALKUP` — open.
2. `ENGINE-PIN-HANDSHAKE` — open.
3. `SETUP-WORKTREE-HELPER` — open.

Next tick's real work is a **build** tick picking off the queue head.

## Open questions (4)

Unchanged from prior ticks (none closed or opened this pass):
- `TAG-PATTERN-SLICE-CONSTRAINT` — NEEDS AMENDMENT.
- `PENDING-NOTES-CAP-VISIBILITY` — NEEDS AMENDMENT.
- `SUPERVISOR-PROVISION-FAILURE-QUARANTINE` — PARKED.
- `SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP` — NEEDS AMENDMENT
  (2 of 3 asks).

## Writable-paths / trunk

- `pending.json`: untouched this tick — verified against disk, already
  matches the 3-entry state left by `14501f9`'s ship; no drift found
  warranting a change.
- `state.md`: rewritten this tick (this file).
- `open-questions.md`: untouched — verified against disk, matches
  content already current.
- `inbox.md`: untouched (already empty, header-only).
- Trunk: HEAD `14501f9` at this pass's start; tree clean besides
  untracked `.flume/loop.pid` (live supervisor's runtime artifact, not
  a plan concern).

Plan continues: no
