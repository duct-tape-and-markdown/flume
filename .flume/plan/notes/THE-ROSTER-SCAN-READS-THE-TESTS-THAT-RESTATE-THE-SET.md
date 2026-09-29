# The extractor hole hid a second stale roster, and two siblings still carry it

Widening the roster scan to `tests/` found the entry's predicted site
(`tests/Dispatcher.test.ts`, provision/merge/gate over a body asserting two).
Replacing the regex extractor with the parser's trivia found a **second**
stale roster the old one was structurally blind to:
`src/Dispatcher.ts:1010` names "merge- and gate-stage" for a fold that now
carries `renderFailures` too. The old reader kept the `//` markers when it
flattened a line-comment run, so any roster an author wrapped across a break
read as two lists with a marker between them — the extractor hole was wider
than the string-literal case the entry named. Both fixed; the test-side fix
also adds the two missing `renderFailures`/`gateFailures` assertions the
comment was already claiming.

The comment reader is now one home: `commentProse`
(`tests/helpers/commentCitations.ts`), over `commentRuns` extracted from the
citation scan's own grouping loop.

**Debt for plan — same hole, two live sites.** `tests/examples.test.ts`
strips comments by `replace(/\/\*[\s\S]*?\*\//g, "")` at `:878` (`importsOf`)
and `:2039` (`normalize`). `examples/cascade-chain.ts:468` declares
`"src/**"`, so that `/*` opens a phantom block and deletes every line to the
next terminator. Today `importsOf` survives because the imports sit above
line 468, which is luck, not a property: the pin is an *absence* verdict
("no runtime value import of the engine"), so a deletion makes it green.
Route both through `commentProse` or a scopeless parse.

Not filed as a question: the fix shape is the one this entry just shipped.
