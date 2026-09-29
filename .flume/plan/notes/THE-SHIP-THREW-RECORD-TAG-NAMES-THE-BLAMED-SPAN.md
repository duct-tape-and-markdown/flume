# The engine half of the ship-throw blame is pinned; the reader half still is not

The wave in `tests/Dispatcher.test.ts` now pins the blame the engine stamps:
one `shipFailures` record, `tag` naming SHIP-THREW and no other, read off both
legs' real verdicts. Mutation-checked — dropping `blamedOn(r.entry)` at
`src/waveMerge.ts:1031` reds it with `undefined` in place of the tag.

Two things the next plan tick may want:

1. The discrimination pin leans on `mergeOutcomes` (merged + not-shipped are
   exactly SHIP-ONE and SHIP-THREW) to show two spans reached the consult. If
   a later wave fixture adds a third shipping span, that assertion is the one
   that moves, not the blame claim.

2. The consumer half is still unpinned, as the entry said: nothing drives a
   real `shipFailures` set through a real `handoff` that keys off it
   (`examples/cascade-chain.ts:519` reads it by tag). This wave produces the
   set but no chain reader decodes it here, so the seam is pinned on the
   writer's side only. That half waits on the cascade `shipped` question —
   worth re-checking whether the question actually blocks a reader-side pin,
   since the reader is already written and the set it needs now exists in a
   fixture that runs in the default lane.
