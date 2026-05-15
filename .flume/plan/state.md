# State

Phase: **v0.1 public-release prep.** Audit tick — 4 entries shipped (EXPORT-WORKTREE-SETUP-CONTEXT, LICENSE, CHANGELOG, README-REVISE). §2 export list now fully covered in `src/index.ts`; LICENSE matches canonical SPDX MIT per §8; CHANGELOG carries the Keep-a-Changelog skeleton with empty Unreleased plus a pre-1.0 note pointing at §2/§9.

Audit finding: README Quickstart imports `flume/examples/minimal-chain.ts` — incompatible with §2 strict `.` exports (no subpaths, per §11 resolved decision) and §8 files allowlist (`examples/` excluded from tarball). §6 also mandates an inline 5-line chain.ts in Quickstart. Build's commit body flagged the conflict for follow-on. Filed `README-QUICKSTART-FIX` (open) at queue head.

Queue head: `README-QUICKSTART-FIX` (open). 9 entries total; `DIST-BUILD-CONFIG` (open, mid-queue) still gates 3 dependents (`PACKAGE-METADATA`, `BIN-FLUME-DIST`, `CI-WORKFLOW`).

In flight: nothing autonomous. Build picks `README-QUICKSTART-FIX` on next tick.

Open questions: 0.

Trunk: `pnpm tsc --noEmit` clean per last green run; `pnpm test` green (7 suites, 68 tests).

Plan continues: no
