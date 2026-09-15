# Two source-scanning walks over `tests/`, selecting by different rules

Shipped as routed: the scan's set is now every `.ts` under `tests/`, read
recursively, and the one finding that surfaced was the entry's measured
one — `as unknown as Runner` in `tests/helpers/stubRunner.ts` prose, beside
its `harness/runner.ts` import. Prose now names the type without writing
the cast; test red on the pre-fix helper, green after.

Observed while there: `tests/` now carries two independent recursive
source walks. `tests/helpers/spawnBudget.ts` (`defaultLaneFiles`) walks the
default lane's root by the suffix rule it reduces off `vitest.config.ts`;
`tests/stubRunner.test.ts` (`suiteFiles`) walks the same root taking every
`.ts`. The sets differ on purpose — the stand-in scan judges files no lane
runs — so neither is the other's copy, but the *walk* is one mechanism
written twice, differing only in a file predicate. A shared
`walk(root, predicate)` in `tests/helpers/` would collapse it.

Filed as shape debt, not correctness: both walks are covered by their own
tests and neither can read a narrower set silently.
