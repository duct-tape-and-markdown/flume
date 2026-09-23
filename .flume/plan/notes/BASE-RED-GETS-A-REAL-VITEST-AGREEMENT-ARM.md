# The base-red arm costs the default lane a second vitest-in-vitest fixture

Shipped as a second top-level describe in `tests/harnessRunner.test.ts` with
its own repo: the first fixture plus one test file both commits hold
identically and both run red, so the span's footprint excludes it and
`runAtBase`'s overlay is provably a no-op (asserted off `git diff
--name-only ... -- tests/cite.test.ts`, not restated).

**Lane cost.** The new case spawns two more real vitest runs (merged tree +
base checkout), ~3.1s; the file is now ~15.1s of a ~158s default lane. That
lane is build's `afterMerge` gate, so its cost multiplies with wave width
(`vitest.config.ts` says so at the top). Every further agreement arm over the
real runner adds a spawn pair. Nothing to file yet, but if a third
real-vitest fixture lands here, whether these belong in the integration lane
is worth deciding deliberately rather than by accretion. Moving them is not
free: a judge line carried only there is carried by nothing the judge sees.

**Fixture sharing.** `link` (the `node_modules` symlink installer) was hoisted
out of the first describe to module scope so both fixtures share one copy.
The rest of the second `beforeAll` is a near-verbatim repeat of the first's:
`git init`, four configs, base commit, span commit, footprint. That is the
second-copy-of-a-sequence shape (`engineering.md`, *A module is one job*),
and a third fixture would make it clearly fileable. At two I left it
un-extracted — the fixtures differ by one `put`, and a builder taking that as
a parameter would hide what each fixture is. Flagging, not deciding.
