# The helper split, but its suite did not

`tests/subprocessHelper.test.ts` (1443 lines) still covers all three modules:
the spawn wrappers it is named for, the state-root leak guard now in
`tests/helpers/fixtureRoot.ts`, and `pinGitAutoGcOff` now in
`tests/helpers/gitEnv.ts`. Its header names all three rather than claiming
one, so no citation is stranded, but the file is the same finding one layer
down (`engineering.md`, *A module is one job*). The split it implies: the
guard describe joins `tests/fixtureRoots.test.ts`, which already owns the
rooting idiom's suite, and the two gc-pin describes want a `gitEnv` suite.
Left out here deliberately — test motion, not the module move the acceptance
named.

`spawnBudget.ts` kept its `harnessSpawnExports`/`harnessBudgets` export names;
only the locals were rekeyed to the wrappers. Renaming the exports would have
rippled into the scan's assertion messages for no mechanical gain.
