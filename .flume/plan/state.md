# State

Phase: **v0.3 SHIPPED + FROZEN** (`0db0500` cut 0.3.0; §§1-17 shipped + audited). **No active spec line** — v0.1/v0.2/v0.3 frozen; no `RELEASE-v0.4.md`. Mode this tick: **audit**.

## This tick — audit 4-commit win32-sweep delta

Delta = 4 commits (1 `build:`, 2 out-of-band `fix:`, 1 `chore(flume):` ship-drain), empty spec-delta, empty inbox, empty pending.

**Audit** (`41ffe1b`..`3e5569c`):
- `abc6368` build: ships `AGENT-TAG-WIN32-BASENAME` → **conforms**: files match entry, both specced assertions present + bonus bare-root test; `runIf(win32)` guard honest (basename splits `\` only on win32 hosts). Clean; `3e5569c` drains it.
- `e360352` fix: (interactive, src + chain.ts) pnpm .cmd-shim spawns → sound, but **two findings filed**:
  1. **`AGENT-SPAWN-WIN32-SHIM`** — `src/Agent.ts:133` spawns bare `claude`; identical .cmd-shim class → ENOENT on win32 npm-installed claude (latent-fatal; this host runs the native exe, which is why the loop survives). Defect repair on v0.1 §2 surface.
  2. **`GATE-EXECGATE-FALLBACK-TEST`** — the new `execGate` ENOENT→shell fallback (`src/builtinGates.ts:31-45`) landed untested → backfill per v0.1 §5.
  Swept remaining spawn sites: `Dispatcher.ts:1333` spawns `process.execPath` (real exe, clean); git execFile calls clean.
- `d4d2317` fix(tests): win32-portable suite → test-lane only, no drift; **closes last tick's accepted-debt** (tests/ `split("/")` slugs).
- `Prompt.ts:187` inline exec hard-requires `sh` on PATH (all dogfood delta blocks render through it — works on this host via Git Bash; degrades to `<exec-failed>` on sh-less win32) → **accepted debt** (shell-choice semantics not derivable from any spec section; commit body).

**Drain:** none (inbox empty). **Derive:** none (spec-delta empty). **Promote:** none (pending was empty).

## Queue (2)

1. `AGENT-SPAWN-WIN32-SHIM` (open) — shell:true retry for .cmd-shim claude spawn, src/Agent.ts:133 + mocked-platform test.
2. `GATE-EXECGATE-FALLBACK-TEST` (open) — runIf(win32) coverage for execGate shell fallback, tests/Gate.test.ts.

## Active plan target

None — no live spec line. Three v0.4 candidate themes parked in open-questions.md (orphaned-baton Axis-C, per-phase agent assignment, entry-scoped write guard); opening `spec/RELEASE-v0.4.md` is a human call. Beyond the two queued defect repairs, new derivable surface requires spec movement, an inbox entry, or an OQ resolution.

## Open questions

**5 (all PARKED, unchanged this tick)**: orphaned-baton Axis-C (v0.4 landing), §7a chain.ts gate-move, teardownWorktree/NEEDS-AMENDMENT unspecced surface, per-phase agent assignment, entry-scoped fanout write guard.

## Writable-paths / trunk

- Wrote `.flume/plan/{pending.json,state.md}`. open-questions.md + inbox.md untouched (no movement, inbox already empty). All on-allowlist.
- Trunk: HEAD `3e5569c` at tick start. tsc green (harness block empty). Suite green on this win32 host since `d4d2317`.

Plan continues: no
