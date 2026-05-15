# State

Phase: **v0.1 public-release prep.** Mode this tick: **audit** — 4 build commits drained pending; 1 chore. Audited each:

- `EXAMPLE-MINIMAL` (1bdf7ff): 67 lines, default-exports Chain, imports only `Chain`/`Phase` from `../src/index.ts`. Trailing block walks host-repo plug-in. Clean.
- `DOCS-CHAIN-EXPORT-FIX` (544736d): both spots fixed — prose now says default-export only; closing snippet uses `export default`. Bonus cross-link added at line 8-9 to minimal-chain.ts (nav improvement, in scope).
- `DIST-BUILD-CONFIG` (5c3c7a7): `pnpm build` emits `dist/{index.js,index.d.ts,cli.js}`; `node dist/cli.js status` loads chain.ts via `tsImport`. **Downstream drift caught**: every `dist/*.d.ts` re-export keeps `.ts` extensions (`rewriteRelativeImportExtensions: true` rewrites .js but not .d.ts under TS 5.9.3 + `verbatimModuleSyntax`). Build flagged it; fails §2 `arethetypeswrong` + bare-specifier import acceptance. Filed `DIST-DTS-EXTENSIONS` (open).
- `DISPATCHER-FANOUT-LOGGING` (8a3c959): all four stage markers present (cherry-pick per shipped entry, ship-commit summary, cleanup count, wave duration); `[flume]` prefix preserved; failure paths untouched. Clean.

Inbox empty. No spec changes. **Promote**: DIST-BUILD-CONFIG shipped → flipped `BIN-FLUME-DIST` and `CI-WORKFLOW` from `blockedBy: DIST-BUILD-CONFIG` to `open`. `PACKAGE-METADATA` re-pointed to `blockedBy: DIST-DTS-EXTENSIONS` (its attw acceptance fails until .d.ts emit is clean).

Queue: `DIST-DTS-EXTENSIONS` (open, new) → `BIN-FLUME-DIST` (open) → `CI-WORKFLOW` (open) → `PACKAGE-METADATA` (blockedBy DIST-DTS-EXTENSIONS). 4 entries total.

In flight: nothing autonomous. Build picks `DIST-DTS-EXTENSIONS` on next tick.

Open questions: 0.

Trunk: `pnpm tsc --noEmit` clean per last green run; `pnpm test` green (7 suites, 68 tests); `pnpm build` succeeds (broken .d.ts is correctness drift, not a build-script failure).

Plan continues: no
