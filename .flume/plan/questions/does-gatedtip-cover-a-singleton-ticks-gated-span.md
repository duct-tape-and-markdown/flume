# Does `gatedTip` cover a singleton tick's gated span, and what does it report over a claimed tip?

`gatedTip` ships read in `drainWaiting`'s land closure (`src/waveMerge.ts`), under
the hold, after the ledger commit resolves, only when that land shipped entries —
exactly as the spec bullet binds it ("its ledger commit landed"). Two arms of that
binding are spec-silent, and both are a chain's problem rather than the engine's.

**1. A singleton tick reports none.** A singleton lands no ledger commit
(`src/singletonTick.ts` says so at its merge span), so the field is absent — yet
its cherry-picked span *is* a gated trunk tip. A delivery step a chain hangs off
`gatedTip` therefore works for fanout phases and silently never fires for
singleton ones, which is the asymmetry nothing announces. If the singleton arm
belongs, the read point is right after `carryMergeSpan` returns `merged`, still
under the lock, and the spec bullet needs the clause. If it does not, the bullet
should say so, so a chain author reads the absence as a statement.

**2. The `tip-claimed` rewrite exit.** `commitAttemptLedger` returns normally when
a live foreign tip claim stopped the rewrite before its writes, so the tip read
fires and may pick up a commit that claimant landed — a sha no gate of this phase
judged, reported as gated. Narrow (the claim is read before the write) and the
same verdict already carries `tipMoved: true`, so the fact is on the surface.
Keying the read off the rewrite's exit would also drop the two legitimate
no-commit exits — footprint already recorded, out-of-tree dock — where the merged
sha genuinely is the gated tip. Options: leave it and let `tipMoved` bound it (the
shipped behavior, with the collision named in the spec); or report the tip only
where the rewrite wrote, and accept that those two exits stop reporting one.

Neither blocked the entry that shipped the field, and no consumer hangs a delivery
step off it yet — which is why this is the moment to rule, before one does.
