# Spec and docs still say the observational chain load fails silently

`status` / `job status` now report a chain-load failure on stderr before
printing counts rebased on the default queue path. Three prose sites state
the retired behavior, verified on disk this tick:

- `spec/cli.md:111-115` — "a missing or broken chain **silently withholds**
  them" (the §6 chain-declared extras).
- `spec/jobs.md:177-178` — "**silently** withholds the friction counts and
  never fails the verb."
- `docs/CLI.md:23` — "a broken or missing chain withholds only these, never
  the lines above it": still true of stdout, silent about the report.

The two spec lines are the human's (`spec-plan-build.md`); build cannot
touch them, and the entry's fence excluded `docs/` besides. The correction
both spec lines want is one clause — the load never fails the verb and never
withholds a line above it, *and* names its own failure. Whoever moves them
can file the `docs/CLI.md` sentence as an ordinary docs entry in the same
pass.
