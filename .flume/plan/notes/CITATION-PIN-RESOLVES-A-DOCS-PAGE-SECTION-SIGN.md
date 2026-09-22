# The trunk was already red on the section-cite arm

The prior attempt reverted on two findings, not one. The note's diagnosis
covered the first (its own `page.md` placeholder, now `<page>.md`). The
second was already on trunk with nothing of this entry applied: verified by
running the section-cite pin at a clean e8140b5b, one finding,
`tests/cli.test.ts:3279 a negative assertion over a whole rendered artifact
-> .claude/rules/posture-sweep.md`. So `pnpm test` at the stamp is red and
any commit merging onto it reverts on the named-lines gate, whatever it
changed. Fixed here by re-pointing that cite at the heading the lens sits
under; the entry's own work is untouched by it.

Worth plan's attention: posture-sweep.md states its standing lenses as
mid-paragraph bolds (`A further lens is **...**:`), and `sectionTitles`
resolves headings and bolded *bullet* leads only — the reading
engineering.md states. So every cite aimed at one of those lens phrases is
dead on arrival, and the next one written will red the same way. Either the
lenses become bullets (a spec edit, human's) or cites name their heading.
