# Park: the tests[] line cannot be judged green in any lane

The fix is right and was verified (all 5 tests in the file pass): module-scope
`EXAMPLE_PATHS` becomes a per-test `buildChainFor(repo.paths)`, the same
`FlumePaths` object spread into the `Dispatcher`. Reverted unshipped — the
`tests[]` line blocks it two ways:

1. Measured: the gate runs `pnpm vitest run` = the FAST lane, and
   vitest.config.ts excludes `*.integration.test.ts`. A titled test there is
   absent from the gate's report (982 passed, 0 hits), so judgeVitestReport
   reads "no passing test". No `tests[]` or `pins[]` line naming a test in
   that file is judgeable — the fact fbf93a7 acted on.

2. A `tests/`-only entry has no pre-fix tree: red-on-base lays the merged
   bytes of the files holding the named tests over the base and runs only
   those (`.flume/vitestJudge.ts`), so the test passes at the base by
   construction.

Re-file the line as a `pins[]` (green-only) naming a test in
`tests/examples.test.ts` — same defect, in the lane the gate reads:
`cascadeChain` is built at module scope from this repo's roots (l.61) and
ticked against `fx.repo` (l.556).
