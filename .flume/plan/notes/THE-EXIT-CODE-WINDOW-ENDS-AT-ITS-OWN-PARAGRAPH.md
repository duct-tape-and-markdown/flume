# The narrowed window needed no page edit, and the break still reads past other paragraph openings

Shipped: `NAMED_EXIT_CODE`, `namedExitCodes` and `sentencesNamingExitCode`
moved from `tests/cliHelp.test.ts` into `tests/helpers/docSections.ts` beside
`sectionOf`, and the sentence break gained a `**` arm, so a paragraph a bolded
lead opens ends the one above it. All six reads take the shared cutter.

Two things for the next plan tick:

1. `docs/CLI.md` was not touched. The entry predicted an edit "only where a
   standing set-equality pin's window narrows"; the full suite (72 files, 1993
   cases) is green with the narrower windows, including both set-equality pins
   (`CLI-DOC-SHARED-ROOT-CAUSES-PINNED-PER-VERB`,
   `CLI-DOC-LOOP-EXIT-CODES-PINNED`). Only the tick section's exit-`0` window
   lost text, and it lost only the `--phase` paragraph's first sentence, which
   no pin was reading.

2. The break is closed for a bolded lead alone, which is the drift measured on
   the tree. Every other paragraph opening still reads through the blank line:
   a paragraph opening with a lower-case word, a list item (`- `), a fenced
   block. `docs/CLI.md` has none of those under a closed sentence today, so
   nothing is wrong now — but the window's rule is "ends at a bolded lead",
   not "ends at its own paragraph", and a page edit that opens a paragraph
   with a bullet or a lower-case continuation re-opens the same glue silently.
   Splitting on the blank line unconditionally is the shape that would close
   the class; it was left out because no drift in it has been measured
   (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* —
   an arm ships with the respelling it found).

Minor: the helper sorts its codes inline (`[...codes].sort`) rather than
importing `cliHelp.test.ts`'s local `ascending`, which stays there for its
other seven callers.
