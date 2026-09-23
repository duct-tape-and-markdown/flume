# The citation fixture's assertions are coupled to its own line numbers

`tests/commentCitations.test.ts` asserts sites as `lib/surface.ts:<n>`, and
the fixture module is built one array entry per line. Widening the section
comment by two lines therefore rewrote every assertion at or past that
point — 10 distinct line numbers across 20 assertion strings, all mechanical,
none of them about the arm under change. The diff reads as churn; a reviewer
cannot tell the two substantive lines from the eighteen shifted ones.

Worth plan's judgment whether that is debt to file. Two shapes that would
cut it: anchor sites by the exported const the comment sits above rather
than by line, or give each new arm its own fixture module so an insertion
never shifts a neighbour. Both are behavior-free; neither is this entry's.

Second observation: the blockquote arm was already shipped in
`sectionTitles` (`tests/helpers/docSections.ts`) with its own case in
`tests/docSections.test.ts`. What this entry closed was the citing case
downstream of it — the resolver knew the altitude, the fixture that proves
the citation surface reads it did not. The shape is a promoted arm whose
downstream fixture did not follow in the same commit; if that recurs, the
generalization is a plan-side check rather than another entry.

I verified the new arm bites rather than riding the bullet-lead arm: with
the `>` branch dropped from the helper's lead pattern, the case reds on the
banner cite alone. Helper restored; full suite green.
