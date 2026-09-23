# The page's new convention line is a claim no pin anchors

Two observations from stating the introducing-verb convention on
`docs/CLI.md`.

**The line sits where a cite cannot name it.** It is a bolded lead inside the
page's opening blockquote, and `leadNamesOf` (`tests/helpers/docSections.ts`)
reads bolded leads off bullets only — so `` (`docs/CLI.md`, *Reading the exit
codes*) `` would not resolve, and the pointer left at `NAMED_EXIT_CODE`
(`tests/cliHelp.test.ts`) names the page and says "its intro" in prose
instead. The page name resolves; the section half is unanchored, so the lead
can be reworded or dropped and the pointer still reads green. Either the lead
becomes a heading, or the lead reader grows a blockquote arm — plan's call,
and neither is correctness-adjacent today.

**The neighbouring vacuity assertion still reds with a bare verb name.**
`expect(codes.length, verb).toBeGreaterThan(1)` sits one line above the
membership assertion this entry gave a message to. It is the read that reds
when a section's *first* code is the one trailing — a section down to one
visible code — which is the same authoring mistake wearing a different
symptom. I left it as the entry named one assertion. Verified on disk: I
perturbed `flume check`'s 74 row into the trailing shape, and the membership
message rendered naming the convention; the page was restored before the
suite ran.
