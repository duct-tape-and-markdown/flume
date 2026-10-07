# The suffix reached further than the two files plan predicted

Observed, while making snapshotReverted append `.reverted` per file:

- Eight existing assertions outside tests/priorAttempts.test.ts spelled a
  snapshot path by hand and had to move with the suffix — three win32
  deep-path cases in tests/Dispatcher.test.ts plus the plan-prose recovery
  case there (the one that reads back open-questions.md / state.md from the
  snapshot). No helper owns "the path a salvaged file lands at", so each
  spells join(dir, rel) itself. That is a vocabulary spelled five ways
  (engineering.md, *A module is one job*): a `salvagedPath(dir, rel)` on the
  store, or an exported pure helper, would make the next change to the
  layout one edit and would let a test cite the rule rather than restate it.
  Noting as debt rather than filing — the shape cannot change behavior
  today, since the suffix is a literal in one place in src/.

- A backticked example path in a src/ comment is read by
  tests/commentCitations.test.ts as a page name that must resolve on disk.
  My first draft illustrated the rule with `notes/x.md` ->
  `notes/x.md.reverted` and the citation pin red on both. Correct refusal,
  and worth knowing: an *illustrative* path in a comment cannot be spelled
  as a `.md` name at all. Rephrased without the example. If plan ever wants
  illustrative paths back, the arm would need a way to mark one as not a
  cite; I did not file that, because precision is not itself a finding.

- `**/*.test.ts` inside a block comment closes the comment (`*/`). Cost a
  typecheck round-trip. Nothing to file; the typecheck caught it loudly.
