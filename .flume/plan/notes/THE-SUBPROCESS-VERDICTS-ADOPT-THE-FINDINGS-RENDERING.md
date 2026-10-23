# The formatters landed beside spawnBudget, not spawnCaps

The entry predicted `tests/helpers/spawnCaps.ts` as the formatter home and
said two formatters already live there. Four do —
`formatSpawnCapSite`, `formatPromisifiedSpawnSite`, `formatSyncSpawnSite`,
`formatSpawnStdinSite` — and every verdict in this file that reads a
spawnCaps scan already mapped through one. What was spelling site lines at
the assertion was the *lane* scans, whose home is
`tests/helpers/spawnBudget.ts`, so the four new renderings
(`formatSpawnSite`, `formatRegistrarCeiling`, `formatSleepingSite`,
`formatSpawnFile`) went there instead. Nothing was added to spawnCaps.

Two things a next tick may want to look at:

- **Formatter non-vacuity cost a fixture rewrite.** `expectNoFindings` over
  a clean tree never produces a site name, so each new formatter needed a
  fixture case asserting its output. Two existing sensitivity pins moved
  from a hand-spelled line to the formatter, which turned exact-string
  expectations into `stringMatching` regexes (the fixture's temp-dir module
  path is not stable). That is a real loss of exactness traded for one
  vocabulary; the pin still names kind, title, line and ceiling.
- **Three verdicts in this file were deliberately left on `not.toEqual([])`**
  — the corpus-spawners pin, the lane-exclusion pin, and the needle
  sensitivity pin. Each claims a set is *non-empty*, so the red renders `[]`
  and chai has nothing to truncate. If plan wants those under the rendering
  too, that is a different claim (`renderFindings` over a populated set,
  asserted `not.toBe(NO_FINDINGS)`) and wants its own entry.

One fixture pin still spells `${basename(f.module)} — ${budgetDefect(f)}`
inline (the four-file budget-defect pin): it is a sensitivity case over a
fixture, not a lane verdict, and its claim is the defect text per file
rather than a site rendering, so it stayed.

Full default lane green: 80 files, 2579 passed, 23 skipped.
