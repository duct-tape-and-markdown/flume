# State

Phase: v0.9 "the doctrine line" shipped and audited (prior tick). This
delta shipped the shape-standard + posture-sweep machinery itself
(`2874c2c`) plus its inbox batch and the 0.9.0 release cut. No new
`spec/RELEASE-*.md` line open.

Mode: audit (commit-delta: 3 commits, no drift — changelogGate correctly
scoped to build's `afterCommit`, `per.path` widening is prompt-guidance
only as intended, release-cut diff routine). Drain: 6 inbox entries — 4
routed to pending (2 fixed the .gitignore/CHANGELOG gaps the inbox named,
2 cited the newly-admissible `.claude/rules/*.md` per-path to unblock
findings previously parked for want of a spec home), 2 parked (win32
argv encoding needs an empirical spike; exec-failed-silent-degradation
needs a product ruling — both flagged high/entangled). Sweep: bootstrap
(no prior stamp; `2874c2c` created the posture pages themselves, phrase
delta, whole domain armed). One neighborhood swept this tick.

## Queue (5)

Head: GITIGNORE-RUNTIME-ARTIFACTS. Then CHANGELOG-0.9.0-BACKFILL,
SCHEMA-PROMPT-AGREEMENT-GATE, PARSEPENDINGLOOSE-WRITE-PATH-PIN,
PENDING-GATE-HINT-OPTION (ascending priority order).

## Open questions (4)

pendingGate dual-violation report — unchanged, PARKED.
setupWorktree/gate manager-detection sharing — unchanged, PARKED.
win32 inline-exec argv mangling (which fix, at which depth) — new,
PARKED, needs empirical spike.
`<exec-failed>` loud-or-nothing vs. shipped tolerance — new, PARKED,
needs product ruling.

## Posture sweep

Posture swept through: `2874c2c` (bootstrap stamp this tick — first
appearance of `.claude/rules/{engineering,posture-sweep}.md`; whole
sweep domain armed as a phrase delta).

Covered this tick: `src/PendingSchema.ts` (self-contained neighborhood —
its only import is `zod`). Found: the seam-agreement gap (routed as
SCHEMA-PROMPT-AGREEMENT-GATE, converging with the inbox drain) and the
prose-only `parsePendingLoose` write-path contract (routed as
PARSEPENDINGLOOSE-WRITE-PATH-PIN).

Remaining frontier: 13 other `src/` modules, all of `tests/`, `bin/`,
`examples/`. Rotation stays open until the frontier empties.

## Trunk

HEAD `2874c2c` (chore(flume): shape standard, posture sweep, and the two
gates that close the recurring misses). Next tick: continue the sweep
frontier, or derive if a new `spec/` line lands first.

Plan continues: yes — sweep frontier open (13+ modules remain)
