# Engine surface shipped; this chain's own placement is still the human's

`PkgManagerOverride` now carries `when`, so `tscGate({ when: "afterMerge" })`
is a one-liner. Two follow-ons plan should route:

1. **This repo's `.flume/chain.ts` still pins `tscGate` at `afterCommit`.**
   Whether the dogfood chain moves it to the merged tree is the open question
   filed alongside this entry — build can't touch `.flume/chain.ts` anyway.
   The surface is no longer the blocker; only the decision is.

2. **Stale narration found and fixed in-commit** at
   `examples/cascade-chain.ts:353` — it justified hand-rolling `shellGate`
   for `vitestOnTrunk` with "that builtin fixes `when: afterCommit` and takes
   no placement override". The real reason survives (the `--reporter=json`
   args the entry-tests judge consumes), so the example still uses
   `shellGate`; only the reason was rewritten. Pattern worth a lens: an
   engine gap cited in a consumer's comment is expired narration the moment
   the gap closes, and nothing but this entry's own diff surfaced it.
