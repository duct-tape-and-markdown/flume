# One span carry, three asymmetries left standing on purpose

`src/mergeSpan.ts` now runs the sequence; both legs call it. Three things I
kept per-leg to hold the fold behavior-free, each a candidate debt line:

1. **Two revert-refused sentences.** The wave logs the recorded failure's
   words, which already name both shas (`unrevertableMergeFailure`); the
   singleton logs the bare refusal and spells the shas itself. One refusal,
   two spellings, so `SpanNarration.revertRefused` hands out both the raw
   words and the recorded failure. Collapsing them changes a log line, which
   this entry forbade — worth a ruling on which line is right.

2. **A footprint reported and dropped.** The carry captures a conflict
   footprint for both legs; the singleton's untagged row drops it, because the
   only reader keys footprints by tag (`commitPendingUpdate`). The fact is on
   the carry's return if a singleton ever wants it on trunk.

3. **Blame stayed at the legs.** The carry returns the gate's `blamesSpan`
   and the wave composes `blamedOn`. The carry has the optional entry and
   could answer blame itself — `entry && blamesSpan !== false` is exactly both
   legs' rule — but the entry said blame stays the wave's, so I left it.

Also folded, unasked: the wave's `checkpointAttempted`/`bystanderCheckpointSha`
pair is now one `BystanderCheckpoint` the carry updates in place, since
"once per carrier" is the caller's span, not the carry's.

Citations the split stranded moved with it — `unrevertableMergeFailure`,
`reportedGateRow`, and the headers of `src/tipVerify.ts` and `src/gateRun.ts`
all named two legs for a fact that now has one home.
