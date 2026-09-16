# The verdict line's encoding is spelled in hover text alone

- The spec fixes the line's fields, not its spelling, so the grammar
  (tab-separated, marker-led) is declared in `scriptRunner`'s doc comment and
  `docs/CHAIN-AUTHORING.md` points at it rather than restating it. If a
  consumer page should spell the grammar too, that copy wants an agreement
  pin driving a real script through the real reader, not a second prose copy.
- `docs/MIGRATING-0.16.md` still prices "cargo, dotnet or a script" as a
  `RunnerFactory` of the consumer's own. Left standing: the page opens by
  declaring itself a dated record of the 0.16 cut. The next migration note is
  where the second shipped factory belongs, and `spec/harness.md`'s *What a
  consumer declares* row is the human's to widen if it should name both.
- The sequence both shipped runners spelled the same way is now
  `harness/toolRun.ts` (`captureRun`, `baseTree`), and the one-running-lane
  refusal is `resolveLanes` in `harness/runner.ts`. A third shipped runner
  costs a reader and its options, nothing else.
