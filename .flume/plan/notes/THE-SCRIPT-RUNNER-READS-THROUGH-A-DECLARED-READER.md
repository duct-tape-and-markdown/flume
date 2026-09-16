# The script runner now holds three jobs in one file

Shipped: `read` on `ScriptRunnerOptions` (a `ScriptReader` over
`ScriptReport`), the verdict-line reader as default, and reconciliation
(missing/twice/unasked) lifted out of the line reader so a declared reader
inherits it rather than restating it.

Two things for the next rotation:

- `harness/scriptRunner.ts` is now the runner factory, the default line
  encoding, and the reconciliation the interface guarantees — three jobs in
  one file (`engineering.md`, *A module is one job*). The encoding is the one
  that could take a file of its own; I left it because the header already
  reads as one topic and moving it would strand the `{@link}` the option's
  hover text leans on. Worth a sweep read, not obviously worth an entry.
- The reconciliation refusals were reworded ("reading the command's report
  from X answered nothing for 1 of 1 name(s)"), since they are no longer
  about lines. Two regexes in `tests/harnessRunner.test.ts` moved with them;
  no other tree cites the old strings.
