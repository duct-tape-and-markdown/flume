# State

Phase: v0.9 "the doctrine line" shipped and audited. No new
`spec/RELEASE-*.md` line open; no commits landed since the last `plan:`
commit (`7d44d3c`).

Mode: maintain (commit-delta empty, no audit trigger; spec-delta empty,
no derive trigger; inbox empty, nothing to drain; no `blockedBy` entries
in the queue, nothing to promote). Verified `pending-now` against disk
while idle: GITIGNORE-RUNTIME-ARTIFACTS named `tick-verdict.json`
(singular) but not `tick-verdicts.jsonl` (plural log,
`Dispatcher.ts:234`) — the file actually sitting untracked in `git
status` this tick. Widened the entry's file list rather than leave a
gap the fix wouldn't close. Sweep: continued the open rotation, one
neighborhood.

## Queue (5)

Head: GITIGNORE-RUNTIME-ARTIFACTS (scope widened this tick). Then
CHANGELOG-0.9.0-BACKFILL, SCHEMA-PROMPT-AGREEMENT-GATE,
PARSEPENDINGLOOSE-WRITE-PATH-PIN, PENDING-GATE-HINT-OPTION (ascending
priority order).

## Open questions (4)

pendingGate dual-violation report — unchanged, PARKED.
setupWorktree/gate manager-detection sharing — unchanged, PARKED.
win32 inline-exec argv mangling (which fix, at which depth) — unchanged,
PARKED, needs empirical spike.
`<exec-failed>` loud-or-nothing vs. shipped tolerance — unchanged,
PARKED, needs product ruling.

## Posture sweep

Posture swept through: `2874c2c` (carried forward; rotation still open).

Covered this tick: `src/Gate.ts` (leaf neighborhood — zero imports of
its own). Found nothing: pure interface/type declarations, no runtime
logic to violate loud-or-nothing or non-vacuity; every exported type
(`Gate`, `GateContext`, `GateResult`, `GatePhase`) is re-exported from
`src/index.ts`'s public surface, so export-earns-consumer holds. The
`GateContext.repoRoot` prose contract ("every dispatcher-constructed
context sets it") is already pinned by
`tests/Dispatcher.test.ts`'s "GateContext.repoRoot (RELEASE-v0.7 §6)"
block for both singleton and fanout paths — no gap to file.

Covered so far: `src/PendingSchema.ts`, `src/Gate.ts`.

Remaining frontier: 12 other `src/` modules, all of `tests/`, `bin/`,
`examples/`. Rotation stays open until the frontier empties.

## Trunk

HEAD `7d44d3c` (plan: audit shape-standard shipment, drain the
downstream inbox batch, open the posture-sweep rotation). Next tick:
continue the sweep frontier, or derive/audit if new commits or a
`spec/` change land first.

Plan continues: yes — sweep frontier open (12+ modules remain)
