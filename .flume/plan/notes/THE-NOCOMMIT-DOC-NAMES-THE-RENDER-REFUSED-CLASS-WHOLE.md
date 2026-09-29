# The block the entry names is `TickOutcome.noCommit`, not `TickResult`'s

The enumerating hover text is `TickOutcome.noCommit` (`src/Dispatcher.ts`),
which is what the entry's path and line pointed at. `TickResult.noCommit`
(`src/Phase.ts`) carries no roster at all — it says "no-commit
classification" and points at a `handoff` reading — so it was left alone and
no third enumeration was created.

That leaves the shipped test title, which the entry's `tests[]` fixed
verbatim, naming a field its body never reads: it pins `TickOutcome`'s block.
A title is a claim (`.claude/rules/engineering.md`, *A green verdict is
proven non-vacuous*), so this one is mislabelled by one type name. Re-titling
it is plan's to file — a build tick may not restructure the line it was
handed.

One helper moved: the doc-comment extractor (`docCommentBefore`,
`docCommentFor`, `srcText`, `srcPath`) left `tests/docComments.test.ts` for
`tests/helpers/docComments.ts`, so the roster seam in
`tests/cliHelp.test.ts` reads blocks the same way the vocabulary scans do
rather than respelling the regex beside them. `docProse` is new there: the
comment furniture off and the wrapping folded, which a read for a wrapped
phrase needs and no existing helper did.

Still unheld: nothing pins that `TickOutcome.noCommit`'s other three bullets
name what a tick records. Only the `render-refused` line is read against a
roster, because only that class has one — `clean-exit`,
`platform-preempt` and `gate-revert` have no array a page and a block could
be read against. If a second surface ever enumerates those, the roster shape
is the cheap fix.
