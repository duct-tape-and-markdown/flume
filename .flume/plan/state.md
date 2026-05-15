# State

Phase: **v0.1 public-release prep.** First plan tick derived 20 entries from `spec/RELEASE-v0.1.md`.

Queue head: `TEST-PENDINGSCHEMA` (open) — bootstraps vitest.config.ts so vitestGate stops blocking every commit on no-tests-found. All other entries `blockedBy` it (or downstream of `DIST-BUILD-CONFIG`, which is `parked` on two open questions).

In flight: nothing autonomous; build picks TEST-PENDINGSCHEMA on next tick.

Open questions: 2 — `CHAIN-LOADER-MECHANISM` (how dist'd cli loads .ts chain.ts) and `CHAIN-WRITABLE-PATHS-TSCONFIG-BUILD` (chain.ts amendment for new top-level config file).

Tests at trunk: still none. `pnpm tsc --noEmit` clean.
