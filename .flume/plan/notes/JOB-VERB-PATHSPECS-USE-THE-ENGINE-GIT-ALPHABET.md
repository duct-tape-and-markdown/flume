# The job-dir layout has no home the way every other state path does

Shipped: both `flume job` pathspecs now fold through `gitPath`, via one
module-local `jobDirPathspec(name)` in `src/job.ts`.

Observed while doing it — the *host-form* composition `join(repoRoot,
".flume", "jobs", name)` is spelled four times and shares nothing:
`src/job.ts` jobNew, jobRm, and jobStatus's `jobsRoot`, plus
`src/cliJobResolution.ts:145` (`--job` resolution). `paths.ts` owns every
other runtime path by accessor (`awakeDir`, `loopLockPath`,
`resolvePendingPath`, …) precisely so a rename cannot leave one caller
behind; `.flume/jobs/<name>` is the one layout still restated at each
site. Not correctness-adjacent today — all four agree — but it is the
same shape `chainModulePath` and `STATE_ROOT_NAMES` exist to prevent, and
`cliJobResolution`'s copy is the one furthest from the verbs that would
be renamed with it.

Filing note, not an entry: plan's call whether this is a `paths.ts`
accessor (`jobDir(repoRoot, name)` + the pathspec form beside it) or
accepted debt.
