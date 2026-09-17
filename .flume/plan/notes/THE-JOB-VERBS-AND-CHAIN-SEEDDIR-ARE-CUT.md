# The job cut leaves the ignore roster homeless

`HELP_JOB` was the only surface that printed `RUNTIME_IGNORES`, read off the
constant (`fillList`, `src/cliHelp.ts`). Both died with the verb. `flume loop
--help` names no ignore merge at all, so the set now ships documented only in
`spec/jobs.md` and one clause of `docs/CLI.md` § `flume loop` ("before the
ignore merge"). Whether `loop --help` should take the roster is a decision I
did not make.

Kept, not cut, against the entry's `files` note: the `--job` state-root
existence guard in `src/cli.ts`. With no verb creating a root, its two
carve-outs (`job new`, `job run`) are gone and it now fires for every `--job`
use — refusing loudly beats silently ticking a root that is not there. It goes
whole with THERE-IS-NO-JOB-SELECTOR, which also takes `jobDir`
(`src/paths.ts`), the last job accessor; `jobsRoot`/`jobDirRel` went here.

`renderFrictionCount` (`src/friction.ts`) lost its last cross-module caller
with `src/cliJobVerbs.ts` and is now module-private — `frictionCountLine` is
the shared entry point.
