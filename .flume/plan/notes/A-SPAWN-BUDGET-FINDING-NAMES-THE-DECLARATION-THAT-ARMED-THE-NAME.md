# The arming declaration landed on the site, not beside the file

Shipped as the operator's option 2. `reachingNames` now folds to
`Map<name, line|null>`; `SpawnSite` carries `awaitedTimer` and a new
`spawnedVia` as `Reaching { name, armedAt }`, and all three lane verdicts
render `formatReaching`.

Two shapes plan may want to know about:

- The reach is **unchanged**. Reading each declaration on its own instead of
  the union of their references is the same predicate (∃d ∃n vs ∃n over the
  union), so the pin was green on the base by construction and nothing
  narrowed. Stated at `reachingNames`.
- `SpawnFile` grew no `spawnedVia` field. `sites` is now a non-empty tuple
  type (`[SpawningSite, ...SpawningSite[]]`), so a finding reads
  `f.sites[0].spawnedVia` with no null arm and no second copy of the site's
  fact (*Derived state is computed*). `SpawningSite`/`SleepingSite` narrow
  the spawn verdicts' `Scan` so no renderer carries a dead "no timer" /
  "no spawn" branch either. If a later entry wants the file-level fact on
  the file, that tuple is the thing to revisit, not the field.

Observed debt, not filed: the three lane verdicts in
`tests/subprocessHelper.test.ts` still each spell their own finding line
inline (`${module} — ${defect}; spawns via …`), while `spawnCaps.ts` ships
`formatSyncSpawnSite`/`formatPromisifiedSpawnSite` beside its scan and
`repoProgram.ts` says the formatter belongs with the scan. I added only the
shared `formatReaching` rather than three per-verdict formatters, because
only the reaching half is this entry's subject and the rest would have been
an unasked refactor of three green verdicts. A sweep read of
*A module is one job* over this pair would see it.

Also: these verdicts assert `.toEqual([])` rather than going through
`expectNoFindings`/`renderFindings`, so chai's 40-char truncation still
applies to them — pre-existing, untouched here.
