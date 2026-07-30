# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-10,
including the §10 migration-guide amendment). No v0.9 spec yet.

Mode: maintain (commit-delta: one chore commit, inbox-only, nothing to
audit against a `per` cite; spec-delta empty; pending-now empty; the
tick's real work is draining the three-finding inbox entry).

## Queue (3)

1. `PENDING-GATE-LAZY-FENCE` — pendingGate reads targetFence eagerly
   at construction; move the read into `run()`, document the builtin
   + lazy-construction pattern in CHAIN-AUTHORING.md.
2. `SCHEMA-HINT-COMMENT-SEPARATOR` — renderSchemaForPrompt's join
   swallows its separator into a hint's trailing `//` comment.
3. `MIGRATION-GUIDE-HANDSHAKE-SCOPE` — MIGRATING-0.8.md §4 overclaims
   the handshake's hard-stop guarantee for a pre-0.7 global binary.

## Open questions (1)

Old-engine blind spot in the pin handshake — structural fix for the
handshake's threat model (chain-side trip-wire vs. documented
non-goal); PARKED for human disposition.

## Trunk

HEAD `2ce6a38` (inbox-only chore commit, drained this tick — no code
to audit against a `per` cite). Inbox's three findings routed: two
filed as pending entries with engine-side fixes (eager-capture read
timing; render separator), one split into a low-risk pending doc
correction plus a parked open question for the structural piece the
finding's own framing ("fix once, structurally") flagged as needing
human disposition, not a plan-tick default.

Plan continues: no
