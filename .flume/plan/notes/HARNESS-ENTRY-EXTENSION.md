# Removal is refused as redeclaration; the chain-side twin now diverges

Judgment call, `harness/entryExtension.ts`: `entryExtension(consumer?)` merges,
so a consumer can never *omit* a package field — the only observable removal is
a consumer key that redeclares one, displacing its schema and hint. That is what
`EntryFieldRemovalError` refuses. If plan meant a different surface (a consumer
handing over a complete extension, checked as a superset), say so in the cutover
entry — it forces every consumer to copy the six, which `engine-boundary.md`
(*Verbatim copying is the detector*) reads as a missing surface.

Twin drift to reconcile at the cutover: the package's `tests` hint says "the
judge proves it passes", where `.flume/chain.ts:117` says "the vitest gate" —
`spec/harness.md` (*The judges*) forbids the package assuming vitest, so the two
hints are now deliberately different strings. The chain's copy is the one that
goes when `.flume/chain.ts` calls the factory; nothing reconciles them before
then, and no gate notices.
