# State

Phase: v0.7 fully shipped (§§1-17); v0.8 fully shipped (§§2-10,
including the §10 migration-guide amendment). No v0.9 spec yet.

Mode: audit (commit-delta: four commits — one ship chore, three build
commits closing last tick's queue; no spec-delta, empty inbox, empty
pending-now).

## Queue (2)

1. `SCHEMA-HINT-FALSE-COMMENT-SPLIT` — renderSchemaForPrompt's
   trailing-comment separator (9f4e62f) matches the first `//`
   anywhere in the line; a hint containing `//` as content (e.g. a
   URL) gets corrupted. Repro'd directly.
2. `CHAIN-AUTHORING-PENDINGGATE-SECTION-CITE` — pendingGate doc blurb
   (480b81c) mis-cites the core+extension schema as §10 instead of §2.

## Open questions (1)

Old-engine blind spot in the pin handshake — unchanged this tick,
still PARKED for human disposition.

## Trunk

HEAD `f6b26f2`. Audited all four commits since last plan against their
`per` cites: `03eabbc` (migration guide handshake scope, v0.8 §10)
verified accurate against current `engineHandshake` (src/cli.ts) —
clean. `480b81c` (pendingGate lazy fence, v0.8 §6) — implementation and
tests solid; caught a doc mis-cite, filed. `9f4e62f` (schema-hint
separator, v0.8 §2) — fixed the reported case but the first-`//`
heuristic false-positives on any hint containing `//` as content (e.g.
a URL); reproduced and filed with a proposed fix direction. `f6b26f2`
is the mechanical ship commit, nothing to audit.

Plan continues: no
