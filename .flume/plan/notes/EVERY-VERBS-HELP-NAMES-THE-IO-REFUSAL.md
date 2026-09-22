# Trunk is red at HEAD, and two 74 gaps past the four pages

**Pre-existing red, not this entry's.** At e8140b5b, with my work reverted,
`tests/commentCitations.test.ts` "every section a src/, harness/ or tests/
comment cites is a section its page still carries" fails on
`tests/cli.test.ts:3279`, which cites `.claude/rules/posture-sweep.md`, *a
negative assertion over a whole rendered artifact*. That phrase leads a
paragraph ("A further lens is **...**"), not a bullet, so `sectionTitles`
(`tests/helpers/docSections.ts`) mints no title for it. bea025fd wrote the
cite, b689d290 shipped the resolver that reads it, and this phase declares
no vitest gate, so the merge never saw it.

**Two 74 omissions past the entry's four pages, fixed here, unpinned:**
`docs/CLI.md` section `flume check` named no 74 at all though `flume check
--help` has carried one; section `flume status` enumerated 74's causes and
omitted the discovery read.
