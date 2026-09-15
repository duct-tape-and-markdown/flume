# The spawn scan now reduces vitest's globs, and over-reads the runner's own excludes

`reduceLaneGlobs` (tests/helpers/spawnBudget.ts) subtracts
`configDefaults.exclude` by identity before reducing, so the walk honours
only the lane's *own* excludes. The runner's defaults (`**/node_modules/**`,
`**/dist/**`, the brace-set ones) are not implemented: the scan would read a
file under `tests/node_modules/` that the lane never runs. Safe direction —
over-reading yields a loud false finding, never a silent green — but it is a
declared gap, not a covered case.

Reducing them properly needs brace/`**`-segment matching, which `matchesAny`
(src/paths.ts) deliberately does not have (`**/` does not collapse to zero
segments there either). If a future lens wants it, that is a matcher
question, not a scan question.

Side effect worth knowing: `scanDefaultLaneSpawnSites` is now async (it
imports `vitest.config.ts`), so any new caller must await it.
