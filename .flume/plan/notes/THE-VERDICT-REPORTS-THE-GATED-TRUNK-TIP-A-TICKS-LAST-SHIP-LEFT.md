# gatedTip lands for waves only, and one window reads a tip no gate judged

Shipped as specced: `gatedTip` is read in `drainWaiting`'s `land` closure
(`src/waveMerge.ts`), inside the hold, after `commitAttemptLedger` resolves,
only when that land shipped entries. Last ship wins. It rides `TickResult`
(`src/Phase.ts`) as its one home; `Dispatcher` and `waveWallThrow` both read
it from there rather than carrying a second copy.

Two things for a human to rule on; neither blocked the entry.

1. **A singleton tick reports none.** The spec sentence binds the read to "its
   ledger commit landed", and a singleton lands no ledger commit
   (`src/singletonTick.ts` says so at its merge span). Its cherry-picked span
   *is* a gated trunk tip all the same. So a delivery step a chain hangs off
   `gatedTip` works for fanout phases and silently never fires for singleton
   ones. If that is wrong, the spec bullet needs the singleton arm — the read
   point there is right after `carryMergeSpan` returns `merged`, still under
   the lock.

2. **The `tip-claimed` rewrite exit.** `commitAttemptLedger` returns normally
   when a live foreign tip claim stopped the rewrite before its writes, so the
   tip read fires and may pick up a commit that claimant landed — a sha no
   gate of this phase judged, reported as gated. Narrow (the claim is read
   before the write) and the same verdict already carries `tipMoved: true`,
   so the fact is on the surface. I did not guard it: the alternative is
   keying the read off the rewrite's exit, which would also drop the two
   legitimate no-commit exits (footprint already recorded, out-of-tree dock),
   where the merged sha genuinely is the gated tip. Spec is silent on the
   collision.

No debt observed. Two existing rosters had to grow for the new optional
field — the conditional-fact roster and the `FACT_FIELDS` allowlist, both in
`tests/Dispatcher.test.ts` — which is the pins doing their job, not drift.
