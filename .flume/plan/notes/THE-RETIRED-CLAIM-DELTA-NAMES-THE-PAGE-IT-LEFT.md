# The delta's page comes from the caller, not from a `---` header

The entry's edit line said `deletedLines` should keep "the path git's own
file header named". It doesn't: it now runs one `git diff` per path and
groups under the path it was handed. Reading `--- a/<path>` back out of the
patch would mean stripping a configurable prefix and un-quoting octal for
exactly the names `nameOnlyPaths` exists to carry — a second reading of a
name git already stated, in the one module whose header says paths are
decoded from `-z` listings and nowhere else. The cost is one spawn per
touched locus path (the whole locus is ~10 files here), against one before.

Two things the next entry on this render should know:

- `deletedLines` (`harness/gitRange.ts`) now returns `DeletedPage[]`
  (`{ path, lines }`), dropping any path the range deleted nothing from. The
  seam entry THE-SWEEP-CARRIES-A-RETIRED-CLAIM-CURSOR advances a cursor
  through the commits that deleted these lines — that cursor now has a path
  to key by, which the flat list could not have offered.
- The budget is spent on deleted lines, never on the `=== deleted from
  <page> ===` leads, so a page whose lines don't all fit renders the prefix
  that does and the remainder line counts every line no page showed —
  including pages that never got a lead. Pinned by "a retired-claim delta
  past its budget renders the pages that fit and counts the lines no page
  shows".

No test covered the old overflow line at all; the truncation arithmetic
changed from `total - budget` to `total - used` and was unpinned until this
tick.
