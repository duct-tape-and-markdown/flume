# The flag spelling still drops a trailing name

`flume help <name>` now answers with that name's page, and one decider
(`helpPageFor`, `src/cliHelp.ts`) serves both it and `flume <name> --help`,
so `job`'s own page cannot be reachable through one spelling only.

Left standing, because the spec names the verb spelling alone: `flume --help
status` still prints the top-level page and drops `status`, the same silent
drop this entry removed from the verb. Every other surface refuses an
unexpected trailing positional (exit 2), so the flag arm is now the one place
argv is discarded. A ruling either way is a one-line change on that same
branch.

Also: `HELP_SUB` lost its cross-module consumer when both arms moved to
`helpPageFor`, so it is module-private now — `HELP_TOP`/`HELP_JOB` stay
exported for `tests/harnessInit.test.ts`.
