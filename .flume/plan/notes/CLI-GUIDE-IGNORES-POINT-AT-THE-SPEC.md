# The ignore set is restated once more, in `src/` this time

Shipped as written: the `job new` bullet is now a pointer at `spec/jobs.md`,
"Runtime ignores".

The remaining copy is not `docs/`, so unlike this entry it reaches a rung
above prose. Verified on disk this tick:

- `src/cliHelp.ts:352` (`HELP_JOB`, the `job new` verb) hand-spells
  `awake/, prior-attempts/, worktrees/, node_modules/, loop.pid` — five of
  the ten `RUNTIME_IGNORES` (`src/job.ts:62`), missing `rendered-prompts/`,
  `tick-verdict.json`, `tick-verdicts.jsonl`, `stop`, `merging/`. Already
  stale.
- Nothing pins it: `tests/cliHelp.test.ts` and `tests/harnessInit.test.ts`
  read `HELP_JOB` only for exit codes and subcommand names; the
  `RUNTIME_IGNORES` importers (`tests/cli.test.ts`, `tests/job.test.ts`)
  never read help text.

This one is shipped CLI output, so the fix has options a doc pointer does
not — interpolate the constant into the template, or pin the help text
against `RUNTIME_IGNORES` and let the roster stay prose. That fork is
plan's, not mine.

`docs/CLI.md:133` (`job rm`) and `:148` (`job status`) still list names, both
as the prior note left them — unchanged here.
