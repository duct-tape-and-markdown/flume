# State

Phase: **v0.3 SHIPPED + FROZEN** (`0db0500` cut 0.3.0, dated 2026-06-22; §§1-17 all shipped + audited). **No active spec line** — v0.1/v0.2/v0.3 all frozen; no `RELEASE-v0.4.md` yet. Mode this tick: **audit**.

## This tick — audit 5-commit delta + drain 2 inbox entries

Delta = 5 commits (all non-`build:`), empty spec-delta, empty pending, 2 inbox entries.

**Audit** (`c3ce6a4`..`0db0500`):
- `b248b72` chore(flume) win32 chain.ts fix → **src/ echo found and filed**: `src/Agent.ts:275` `withTerminalRenderer` default tag has the identical `inv.cwd.split("/").pop()` bug → pending `AGENT-TAG-WIN32-BASENAME` (per v0.1 §2; defect repair on shipped surface, not new derivation). Also swept tests/: `Dispatcher.test.ts:172,661,1205` fake-agent slugs use the same split — green on this win32 host, test-internal → accepted debt.
- `a59a0f2` executes OQ "v0.1.1 tag vs CHANGELOG" disposition A verbatim (fix text, keep tags) → **OQ closed/removed**.
- `0db0500` cuts 0.3.0 → v0.3 now frozen per ship→freeze posture → orphaned-baton OQ updated: recommended landing is now a **new `spec/RELEASE-v0.4.md`** line, not a v0.3 append.
- `c3ce6a4` adds `pnpm-workspace.yaml` (new root file, absent from spec-plan-build lane table) → accepted debt; table addition is a rules edit = human surface.
- `cdfe399` inbox append — proper external-contributor lane.

**Drain** (both entries → parked OQs; net-new API surface, no spec authority, cites verified live):
- per-phase agent/model → OQ (rec: v0.4 section, `Phase.agent?: Agent` resolved phase ?? chain ?? default; global `--model` already expressible via `extraArgs`).
- entry-scoped fanout write guard → OQ (rec: v0.4 section, enforce on `assignedEntry` ticks; flags that enforcement flips `files` from advisory to load-bearing — plan-side obligation).

**Derive:** none (spec-delta empty). **Promote:** none (pending was empty).

## Queue (1)

1. `AGENT-TAG-WIN32-BASENAME` (open) — platform basename for renderer default tag, src/Agent.ts:275 + test.

## Active plan target

None — no live spec line. Three v0.4 candidate themes now parked and cross-referenced in open-questions.md (orphaned-baton Axis-C, per-phase agent assignment, entry-scoped write guard); opening `spec/RELEASE-v0.4.md` is a human call. Next derivable surface requires new `spec/` movement, an inbox entry, or an OQ resolution.

## Open questions

**5 (all PARKED)**: orphaned-baton Axis-C (updated → v0.4 landing), §7a chain.ts gate-move, teardownWorktree/NEEDS-AMENDMENT unspecced surface, per-phase agent assignment (new), entry-scoped fanout write guard (new). v0.1.1-tag OQ closed this tick.

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md,open-questions.md}` + `.flume/inbox.md` (drained). All on-allowlist.
- Trunk: HEAD `c3ce6a4` at tick start. tsc green (harness block empty). Fast vitest lane green; integration lane via `test:integration` at host.

Plan continues: no
