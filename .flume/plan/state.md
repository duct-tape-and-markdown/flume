# State

Phase: **v0.3 line ACTIVE** — `spec/RELEASE-v0.3.md` (foundations governor §§1-9, relocatable state §§10-15, §16 flumeDir exposure, §17 test-suite lanes). Mode this tick: **audit**. v0.1 + v0.2 frozen.

## This tick — audit TEST-SUITE-LANES ship

Delta = 2 commits (`2bdb2bb` build: vitest lane split; `5981b67` chore: drain pending → []). Commit-delta → audit.
- **Audit `2bdb2bb` vs §17 — clean, accept.** Verified against the §17 deliverable list, point by point:
  - `vitest.config.ts` excludes `**/*.integration.test.ts` from default; integration lane gated by `VITEST_LANE`. Verified live: fast lane lists **0** integration files; integration lane lists only the integration suite.
  - `package.json` gains `test:integration` (`VITEST_LANE=integration vitest run`).
  - `tests/loop-process-boundary.test.ts` → `.integration.test.ts` (rename; old retired).
  - `docs/CHAIN-AUTHORING.md` documents the lane convention.
  - **No `src/` change** (correct per §17a "No runtime fix"). **No scope creep** — exactly the 4 files in `entry.files`. Mechanism = filename-convention + config-exclude, the §17a-sanctioned default.
- `5981b67` is the harness `chore(flume):` drain (pending → `[]`), not a `build:` commit — no `per`-cite audit surface.
- **Derive:** spec-delta empty (no `spec/` change since last `plan:`). No derive.
- **Drain:** inbox empty.
- **Promote:** pending empty; no blocked entries.

## Queue (0)

Empty. v0.3 derivable surface complete (see below).

## Active plan target

`spec/RELEASE-v0.3.md` — §§1-17 all shipped + audited (§17 is the final section; confirmed no later sections). **v0.3 derivable surface is complete.** No further derivation until new `spec/` movement, an inbox entry, or an open-question resolution opens fresh surface.

## Open questions

**4 (all PARKED)** — unchanged this tick:
- §7a chain.ts gate-move (off-allowlist chore lane)
- v0.1.2 worktree surface unspecced
- v0.1.1 tag vs CHANGELOG
- orphaned-baton Axis-C (wants a new v0.3 section)

## Writable-paths / trunk

- Wrote `.flume/plan/state.md`. pending.json already `[]`; open-questions/inbox unchanged. No off-allowlist path.
- Trunk: HEAD `5981b67`. tsc green. Fast (default) vitest lane green and worktree-safe; integration lane runs at host via `test:integration`.

Plan continues: no
