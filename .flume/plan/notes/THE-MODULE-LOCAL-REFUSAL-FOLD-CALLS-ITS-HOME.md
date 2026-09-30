# The module-local fold is gone; one sibling read came with it

`refusalMessage` is deleted from `src/waveMerge.ts`; both callers
(`WaveCarriedThrow`'s ctor, `settledWaveVerdict`'s `why`) now read
`thrownMessage` (`src/thrown.ts`). Acceptance grep names `src/thrown.ts:39`
alone.

Two things the next plan tick may want:

1. **One site beyond the entry's two.** `src/waveMerge.ts:839` spelled
   `shipThrew = throwFacts(err).message` — not the `instanceof Error ?` guard
   the acceptance grep hunts, but the exact derivation `thrownMessage` *is*,
   at a site whose record is one log sentence. Folded in the same commit so
   the module reads one way. Byte-identical: `thrownMessage` is
   `throwFacts(err).message`. If plan would rather the family entry stay to
   its named sites, say so and I will keep the next one narrow. No other
   `throwFacts(...).message` remains in `src/`.

2. **The shrink re-homed a claim, not just prose.** The deleted doc comment
   was the only place stating that the carry's message and the verdict summary
   share a spelling *so they cannot describe one refusal differently*. That
   claim moved to `settledWaveVerdict`'s header, which is the site that would
   drift. Nothing pins it — a pin would be "the `WaveCarriedThrow` message and
   the `TickVerdict` summary for one cause are equal", which is decidable and
   currently prose. A candidate for the ladder if the family recurs; not filed,
   since the shared call makes it true by construction today.

Behavior-free as named: no test changed, `pnpm tsc --noEmit` and `pnpm test`
green.
