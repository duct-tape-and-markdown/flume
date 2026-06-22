# State

Phase: **v0.3 line ACTIVE** — `spec/RELEASE-v0.3.md` (foundations governor §§1-9, relocatable state §§10-15, +§16 flumeDir exposure). Mode this tick: **maintain** — empty delta, no actionable dimension. v0.1 + v0.2 frozen.

## This tick — no-op (empty delta)

HEAD == last `plan:` (`417791f`). No commits to audit, no spec delta to derive, inbox empty, no blocked entry to promote. All four dimensions inert:
- **Audit:** no commits since `417791f`. Nothing to cross-check.
- **Derive:** no `spec/` change. v0.3 derivable surface already complete (§§1-16 all derived).
- **Drain:** inbox empty.
- **Promote:** the lone pending entry is already `open`; no `blockedBy` gates outstanding.

Only state.md re-derived. pending.json / open-questions.md / inbox.md unchanged from `417791f`.

## Queue (1)

- **FLUMEDIR-CONTEXT-EXPOSURE** (`open`) — §16 flumeDir exposure; ready to ship. Build can pick it directly.

## Active plan target

`spec/RELEASE-v0.3.md` — §§1-15 shipped+audited clean; §16 derived (1 open entry, unbuilt). **v0.3 derivable surface is complete.** Next plan work needs a new `spec/` section, an inbox finding, or an OQ resolution — none present this tick.

## Open questions

**5 (all PARKED).** Unchanged this tick — empty delta implicates none:
- OQ#1 (§7a chain.ts gate-move, off-allowlist chore lane)
- OQ#2 (v0.1.2 worktree surface unspecced)
- OQ#3 (v0.1.1 tag vs CHANGELOG)
- OQ#4 (orphaned-baton Axis-C)
- OQ#5 (§16 dogfood chain.ts gate adoption — off-allowlist, blocked on FLUMEDIR-CONTEXT-EXPOSURE shipping)

## Writable-paths / trunk

- Wrote `.flume/plan/state.md` only. pending.json, open-questions.md, inbox unchanged. No off-allowlist path.
- Trunk: HEAD `417791f`. Plan-artifact-only tick. tsc not re-run (no src/ delta).

Plan continues: no
