# The clearing read, and one spelling of the foreign tip claim

Shipped as named: `land` (`src/waveMerge.ts`) now *decides* `gatedTip` on
every land that shipped — read the tip, or clear it on the `tip-claimed`
exit — instead of skipping the write and leaving an earlier pick's tip
reported as the last ship's. All four doc sites (`src/Phase.ts`,
`src/tickVerdict.ts`, `src/Dispatcher.ts`, `docs/CHAIN-AUTHORING.md`)
already promised the absence, so no prose moved; the `WaveMerge.gatedTip`
field comment did, since it said "overwritten by each later pick that
ships", which is the skipped-read shape.

Two observations for the next rotation, neither blocking:

1. The claim-staking in `tests/Dispatcher.test.ts` was spelled once inside
   `waveRefusedByTipClaim`; the second arming needed it, so it is now
   `stakeForeignTipClaim` at module scope and both waves call it
   (`engineering.md`, *The fix lands at the mechanism*). The claim path
   still comes from `git.tipClaimPath` / `git.gitCommonDir`, never a second
   spelling of the layout.
2. The pins[] line landed as `waveShippingTwice`'s no-claim arm, which
   overlaps the older "gatedTip names the tip after the last ledger commit
   of a multi-ship tick" — same two-ship wave, same `ledger[1]` claim. The
   new one is the discriminating control the absence case needs beside it
   and the older one additionally pins reachability of every merged span
   from the reported tip, so neither is redundant with the other's whole
   claim; worth a look if a future entry touches that block, since a third
   two-ship wave would be.

The remaining `tip-claimed` neighbour I did not open: a *batched* land that
ships several picks and takes the claim exit clears the field the same way
(one `land` call), but nothing pins the batch arm of `gatedTip` at all —
present or absent. No drift measured, so no entry filed.
