# The spec sentence still reads as first-match-wins

`spec/harness.md`, *The cite resolver*, says only that "the section must be a
heading in that file at that commit". The package now refuses a section text
the page heads more than once — sibling or nested — so the resolver is
stricter than the sentence describing it, and spec is the human's surface.
Worth a directed edit ("heads exactly one section") or an open question.

Two things observed while fixing it:

- The old scan stopped looking once it had a start, so a duplicate nested
  *inside* the first match's own section was invisible twice over. The fix
  collects every real heading first, then bounds each match, which is why the
  nested case in the new fixture is caught and not only the sibling one.
- `.claude/rules/spec-writing.md`, *A heading is an identifier*, is the prose
  this promotes to a rung — it could shrink to a pointer at the resolver.
  Spec locus, so the human's edit, not a build tick's.

No duplicate heading exists in `spec/` or `.claude/rules/` at this tip, so the
per gate is unaffected by the new refusal.
