# The non-recursive read is now the scan's only exemption mechanism

Widening to every top-level `tests/*.test.ts` landed green — 50 files,
44 naming engine types, 0 stand-in casts. Two notes:

**`tests/helpers/` is a real blind spot, not a tidy one.** The shared
typed stand-ins live there, and they are where a future `as unknown as`
would do the most damage — one helper's escape hatch flows into every
adopter. It stays unscanned only because `readdirSync` is non-recursive;
that exemption is now load-bearing and declared by nothing but the doc
comment. Recursing is not free: `helpers/stubRunner.ts` imports `Runner`
*and* quotes `as unknown as Runner` in prose, so a recursive scan reads
a false finding out of a comment, and the scan has no comment-stripping.
Either the helper's prose loses the literal or the scan learns to strip
— a fork worth a decision, not a silent widening.

**`*.integration.test.ts` files are scanned as text but not run.** They
sit in the glob, so their casts are judged, while the default lane never
executes them. Correct here (this scan is a text read, not an execution)
but it is the first place in the suite where that split holds.
