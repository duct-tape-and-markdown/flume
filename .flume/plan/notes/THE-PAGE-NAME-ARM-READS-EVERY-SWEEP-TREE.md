# The scopeless walk is now spelled twice

`modulesUnder` (`tests/helpers/repoProgram.ts`) and `parseScopeless`
(`tests/helpers/commentCitations.ts`) are the shared home for the
`{trees, files}` domain walk and the no-scope parse. `tests/helpers/spawnCaps.ts`
still carries its own private `spawnCapModules` and `parse`, doing the same two
jobs on the same two shapes — the duplication a5243281 tried to close by
lifting them out, and reverted on the dangling callers. Closing it now is a
three-callsite edit inside spawnCaps plus an import swap; this entry did not,
because plan scoped that file out. Worth one entry per
`.claude/rules/engineering.md`, *A module is one job*.

Two hand-kept lists live in `tests/commentCitations.test.ts`: `PAGE_ARM_DOMAIN`
(what the page arm adds) and `SWEEP_DOMAIN` (what the posture page names). The
new pin asserts their union with the program scan's three trees covers
`SWEEP_DOMAIN`, so a tree added to the sweep and to neither reds. Nothing
mechanical reads the posture page itself, so `SWEEP_DOMAIN` drifting behind a
ratified phrase change stays a prose-to-prose gap the ladder does not
administer.
