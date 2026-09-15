# Deny the read path, never a parent; three sites left standing

The rule the helper is built on, now pinned in `tests/denial.test.ts`:
denying a *parent* structurally un-arms the fixture. `statSync` with
`throwIfNoEntry: false` — `existsLoud`'s call — suppresses **ENOTDIR as well
as ENOENT**, so the gate above the refusal takes its absent arm; and win32
reports a path *through* a non-directory as not-found outright. That second
half is what the lane read off `PriorAttemptStore.readAll` (the input
`PRIOR-ATTEMPTS-ABSENCE-IS-PROVEN-NOT-INFERRED` carries): its fixture denies
the parent of the dir it enumerates. Wants a `platform-facts.md` line.

Not moved, for `A-POSIX-ONLY-CASE-DECLARES-ITS-HOST`:

- `tests/job.test.ts` ensureRuntimeIgnores: a directory denies the read, but
  the "template line survives" assertion then goes vacuous — a rewrite would
  EISDIR too. Wants a declared host, not a substitute.
- `tests/cli.test.ts` / `tests/cliHelp.test.ts` friction stat arm (`0o444`):
  the site already declares no permission-free fixture reaches it.
- `tests/git.test.ts` PINLONGPATHS is a *write* denial; read-only does deny
  writes on win32, and that describe is win32-only.
