# The page arm judges one segment; the dotted class is open

Shipped: `packageSurface` (`tests/helpers/exportGraph.ts`) hands out every
name the exports map *reaches* — exported symbols, their members, and the
string-literal arms of reached types — off the same emit+reach walk the
export verdict runs. `scanPageIdentifiers` (`tests/helpers/pageAnchors.ts`)
judges the three interface pages against it.

**A dotted span is left unjudged, and that is a plan entry.** On a page
`chain.ts` and `Chain.pendingDir` are one spelling, and the page carries no
citing module to tell them apart: the file arm drops every member citation,
the member arm reds every filename on its extension. Measured over the three
pages: 358 single-segment spans judged, 138 dotted spans (60 distinct) left
out — `Chain.capabilities`, `ctx.flumeDir`, `TickResult.stakeLosses` and the
like, against ~9 filenames. A class the carve-out's predicate admits and the
suite does not resolve, so per that section it files as an entry, not a
question. A workable discriminator: resolve the head segment against the
surface *and* the whole span against the working tree, and file the span only
where exactly one answers.

The arm found real rot, fixed here: `docs/CHAIN-AUTHORING.md` named
`bundleFreshnessGate` and `bundleSelfContainmentGate`, two gates the tree
holds nowhere, plus `createWorktree`, `builtinGates` and `buildFlumeApi` —
engine internals a consumer cannot import. All five are now prose.

Five names joined the exclusion list (`tsImport`, `TerminateProcess`,
`enableGlobalVirtualStore`, `devDependencies`, `nextPhase`). It now serves
three readers, so its loader moved to `tests/helpers/externalVocabulary.ts`
and its non-vacuity union gained the page set.

Two shared reads landed beside the arm: `proseLines`
(`tests/helpers/docSections.ts`) is now the one fenced-block rule, and
`fencedSpans` (`tests/helpers/commentCitations.ts`) the one backtick pairing.
