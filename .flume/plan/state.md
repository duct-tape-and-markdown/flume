# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-10,
including the §10 migration-guide amendment). No v0.9 spec yet.

Mode: audit + drain (commit-delta: two commits; inbox: two findings).

## Queue (2)

1. `PIN-HANDSHAKE-SELFREF-AUTHORITY` — open. Self-ref guard (54d0d70)
   makes every repo-root-pinned+provisioned bay refuse; fix so
   self-reference proceeds as authority.
2. `PENDING-GATE-FENCE-WHEN` — open. Add `fenceWhen` predicate to
   `pendingGate` so chains can exempt park-exempt entries.

## Open questions (0)

None.

## Trunk

HEAD `2637581`. Audited a0e3236 (--no-save fix + 0.8.0 release cut)
against v0.8 §9 — CHANGELOG/version-bump shape matches, no other
`npm install` site missing `--no-save`, no drift. 2637581 is inbox-only
(no code); nothing to audit there. Drained both inbox findings this
tick, both verified against current `src/` before filing (self-ref
guard confirmed live and tested at `tests/cli.test.ts:506-577`;
`pendingGate`'s unconditional fence confirmed at
`src/builtinGates.ts:261-266`) — filed directly per collaboration.md's
research-before-park posture, no open questions needed.

Plan continues: no
