# State

Phase: **v0.3 line ACTIVE** — `spec/RELEASE-v0.3.md` (foundations governor §§1-9, relocatable state §§10-15, §16 flumeDir exposure). Mode this tick: **audit**. v0.1 + v0.2 frozen.

## This tick — audit §16 delta; §16 fully shipped

Delta = 2 commits (`b62d1b6` build §16, `cd03386` chore §16 reference use). No spec delta, inbox empty, no blocked entry.
- **Audit:** both commits implement §16 correctly. `b62d1b6` adds `GateContext.flumeDir` / `TickContext.flumeDir`, auto-injects reserved `{{FLUME_DIR}}` (chain arg can't shadow), leaves `writablePaths` env-derived (§16b) — all four sites; tests cover default+relocated GateContext, TickContext at tick time, no-arg `{{FLUME_DIR}}` render (§16a). `cd03386` rewrites dogfood `pendingParseGate` to `join(ctx.flumeDir,"plan","pending.json")` — exactly OQ#5 disposition A. tsc green; §16 coverage passes.
- **Derive:** no `spec/` change. v0.3 derivable surface complete **and now fully built** (§§1-16).
- **Drain:** inbox empty.
- **Promote:** none.

**FLUMEDIR-CONTEXT-EXPOSURE shipped → dropped from pending** (re-derived empty; surface is in `src/` + tests). pending.json now `[]`.

## One test failing — pre-existing, not a §16 regression

`tests/loop-process-boundary.test.ts` (2nd case) times out at vitest's 30s default — real `tsx`/CLI subprocess cold-starts. Last touched by `1152671`, untouched by the delta. `b62d1b6` cited it ("worktree-hostile … recorded as a follow-up finding") but it had no plan-artifact home → parked as a new OQ (options + tradeoffs; confirm slow-vs-hung before tuning).

## Queue (0)

Empty. No open pending entries.

## Active plan target

`spec/RELEASE-v0.3.md` — §§1-16 shipped + audited clean. **v0.3 derivable surface complete and built.** Next plan work needs a new `spec/` section, an inbox finding, or an OQ resolution (e.g. the parked Axis-C orphaned-baton wants a new v0.3 section) — none actionable autonomously this tick.

## Open questions

**5 (all PARKED).** OQ#5 (§16 dogfood gate adoption) RESOLVED by `cd03386` → removed; replaced by the new test-infra finding. Net 5:
- OQ#1 (§7a chain.ts gate-move, off-allowlist chore lane)
- OQ#2 (v0.1.2 worktree surface unspecced)
- OQ#3 (v0.1.1 tag vs CHANGELOG)
- OQ#4 (orphaned-baton Axis-C — wants a new v0.3 section)
- OQ#5 (process-boundary tests exceed 30s + fanout-hostile — test-suite policy unspecced)

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}`. inbox unchanged. No off-allowlist path.
- Trunk: HEAD `cd03386`. tsc re-run green; full vitest 113/114 (1 pre-existing timeout, see above).

Plan continues: no
