# Parked on the first tests[] line, not on the work

The arm shipped in this commit: section cites resolved on both scans,
`sectionTitles` in `tests/helpers/docSections.ts`, 34 drifted cites across
20 modules expanded, 760 cites scanned and 0 findings, suite green.

Parked on the naming alone. The line "a comment's (`page.md`, *Section*)
pair resolves ..." embeds `page.md`, which the title arm reads as a page
name and the working tree cannot answer, so titling a test with it verbatim
reds the standing pin "every *.md page name a src/, harness/ or tests/ title
carries names a file the working tree holds". Measured, not reasoned.

The test ships titled with `<page>.md` instead — the placeholder charset
refuses it, so the title pin stays green. The second line ships verbatim.

Both behaviors are on the tree, so the entry should drop at the next derive
rather than re-file: any respelling of line one is now green at base.

Observed beside it: `.claude/rules/posture-sweep.md` states three lenses as
mid-paragraph bold runs, which neither a heading nor a bullet-lead read can
resolve. Their three cites now name the owning heading.
