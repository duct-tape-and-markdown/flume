# State

Phase: **v0.3 line ACTIVE** — `spec/RELEASE-v0.3.md` (foundations governor §§1-9, relocatable state §§10-15, §16 flumeDir exposure, §17 test-suite lanes). Mode this tick: **derive**. v0.1 + v0.2 frozen.

## This tick — derive §17; resolve OQ#5

Delta = 1 commit (`87237c2` spec: add §17 — test-suite lanes). Spec-delta → derive.
- **Derive:** §17 → one entry **TEST-SUITE-LANES** (gate open). Split vitest into fast (default `vitest run`) + integration (`*.integration.test.ts`, excluded from default, run via `test:integration`) lanes. All build-writable (`vitest.config.ts`, `package.json`, `tests/**`, `docs/**`); no `src/`/chain change. The exclude lands in the same commit whose afterMerge gate benefits (gate runs the narrowed `vitest run`), so it's self-greening — gate open, not blocked.
- **OQ#5 RESOLVED → removed.** §17 specs the test-suite policy OQ#5 was parked for (no `per` cite) and adopts its option B (integration lane partition, host-run). The finding now carries a clean `per` cite (§17) and becomes TEST-SUITE-LANES.
- **Audit:** delta is a human-authored spec commit (not a build commit) — no build-audit surface this tick.
- **Drain:** inbox empty.
- **Promote:** no blocked entries.

## Queue (1)

- **TEST-SUITE-LANES** (open) — §17 vitest lane split. Next to ship.

## Active plan target

`spec/RELEASE-v0.3.md` — §§1-16 shipped + audited; §17 derived this tick (1 entry, buildable). v0.3 derivable surface = TEST-SUITE-LANES pending; once it ships, surface is complete again pending new `spec/`/inbox/OQ movement.

## Open questions

**4 (all PARKED).** OQ#5 (process-boundary tests / test-suite policy) RESOLVED by §17 → removed. Net 4:
- §7a chain.ts gate-move (off-allowlist chore lane)
- v0.1.2 worktree surface unspecced
- v0.1.1 tag vs CHANGELOG
- orphaned-baton Axis-C (wants a new v0.3 section)

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}`. inbox unchanged. No off-allowlist path.
- Trunk: HEAD `87237c2`. tsc green. (Full vitest carries the one pre-existing process-boundary timeout — exactly what TEST-SUITE-LANES removes from the default run.)

Plan continues: no
