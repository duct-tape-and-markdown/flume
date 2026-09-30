# The dirent-kind limit landed; one site outside `files` was restating it

Shipped as filed: the case lives in the `denyFile` block of
`tests/denial.test.ts`, drives the real `readQueueOnDisk`, and asserts three
things in order — the seeded entry reads (non-vacuity), the denial really
landed at that path (present to a stat, non-ENOENT on a direct read), and the
reader answers `[]` rather than refusing. The middle step is what makes the
case say "the read never happened" instead of "the denial did not work".

Two things worth plan's attention.

**A third file changed.** `tests/cli.test.ts:1691` carried the same limit as
five lines of prose, written when the symlink workaround was chosen. With the
limit pinned that is residue (`engineering.md`, *Narration is the ladder's
bottom rung*), so it shrank to a pointer at the case and kept only the
site-local decision (why a symlink). Outside the entry's `files`, same family,
one commit.

**The header now claims more than two shapes.** `tests/denial.test.ts`'s
header said it covers "the two shapes the suite's refusal fixtures are built
on". It now also covers the fixture's *limits* — the parent-denial converse
was already there under the `denyDirectory` block, and this is the second — so
the header gained a paragraph naming that as part of the module's one job. If
a third limit arrives, that paragraph is the home rather than a new file.

No debt observed beyond that. The case adds three `src/` imports to a module
that previously imported only `node:fs`; that is the entry's own instruction
("driving the real reader") and the only way the limit shows, since it is the
reader's shape meeting the denial's.
