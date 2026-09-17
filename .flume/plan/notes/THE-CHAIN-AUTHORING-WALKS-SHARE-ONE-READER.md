# The reader landed beside docSections, not inside it

The entry named `tests/helpers/docSections.ts` as its home; it went to a new
`tests/helpers/docWalk.ts`. The reader builds a TS program, reads disk and
asserts through `expect`, while docSections declares itself the markdown
section cutter — pure string reads. Folding it in would make that header
disclaim its body, the same defect the entry cites. docWalk imports
`sectionOf`; the cut stays put.

Side effect: `tests/helpers/repoProgram.ts` says a compiler-API tier moves
there at its second consumer. The cheap single-module tier had three copies;
it now has one, so it stays out.

Remaining copy, same family, out of scope here: the supervisor-policy and
gate-section walks each keep a `bulletFor` local — one bullet's body through
the next lead, wrapping folded — differing only in the page's emphasis. Two
copies, ~8 lines each, and that read is docSections' job (a `bulletOf` beside
`walkOf`). A third walk wanting a per-bullet claim copies whichever is nearer.
