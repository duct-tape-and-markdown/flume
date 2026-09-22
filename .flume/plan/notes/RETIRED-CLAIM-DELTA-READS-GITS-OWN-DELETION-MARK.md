# The delta keeps diff spelling, so a `--` claim renders as `---`

`deletedLines` (`harness/gitRange.ts`) now filters on git's own
`--output-indicator-old` mark, then re-spells that mark back to `-` before
handing the lines out. Keeping the `-` was a call I made rather than
stripping the prefix: it leaves every existing render byte-identical and
keeps the delta block visibly quoted rather than bare sentences inside the
prompt. The cost is that a retired claim whose text began with `--` reaches
the plan agent spelled `--- a dashed claim.`, which reads like a
`--- a/<path>` file header. The block's own header labels it, and the two
live sites the entry named are `.claude/rules/*` lines, not spec, so nothing
in the current locus hits it yet. If a sweep tick ever misreads one, the fix
is to drop the re-spelling and let the delta carry bare text — one `.map`
and one test expectation.

Measured while fixing: `--output-indicator-old` renames the deletion
indicator alone; `--- a/<path>` and `+++ b/<path>` headers keep their
dashes. That fact is now pinned by "the retired-claim delta excludes the
diff's own file-header lines", so it needs no prose home.
