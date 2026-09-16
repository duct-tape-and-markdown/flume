# Runner pricing now lives on two doc pages; the node table is a third copy

Shipped both halves. Two things the next plan tick may want to weigh:

1. The runner pricing is stated twice - `docs/MIGRATING-0.16.md` s6
   ("Pricing the runner row") and `docs/CHAIN-AUTHORING.md` ("What adoption
   costs"). The entry asked for both, and the pages have different jobs (dated
   record vs standing reference), but if `Runner`/`RunResult` changes shape the
   two go stale independently and nothing pins either. The standing home is
   CHAIN-AUTHORING; a dated note cannot safely point at a live page, so the
   copy may be right - flagging rather than deciding.

2. The new s0's node-version table restates measurements from
   `.claude/rules/platform-facts.md` (*A CommonJS-scoped `chain.ts` stops
   loading...*) for a consumer audience. Same drift exposure, and `docs/` is
   outside the sweep domain, so no lens re-reads either copy.

No test or pin: the entry claims no property, and both files are shipped prose
rather than behavior.
