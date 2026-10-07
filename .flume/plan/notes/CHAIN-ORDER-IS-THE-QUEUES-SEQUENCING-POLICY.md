# Chain.order shipped; three calls the spec left to the engine

Three judgment calls made at the site, each cited in a docstring — flag any
the spec wants said differently.

1. **What "a permutation" is keyed on.** By tag, and the entries served are
   the engine's own reads in the returned tags' order (`orderedForSelection`,
   `src/selection.ts`). A hook returning copies still only orders: it cannot
   swap the declaration a tick is dispatched against. Identity-keyed would
   have refused that hook instead; the spec's "added, dropped, repeated" is
   tag-level, so tag-level it is.

2. **`OrderContext.blockedBy`'s shape.** `ReadonlyMap<tag, readonly tags[]>`
   carrying the *standing* edges — a blocker absent from the queue is settled,
   so absent from the list. Keyed only for entries declaring the gate: no key
   means "names none", an empty list "named some, all settled". The settled
   complement is derivable from `queue`, so both would be a restated copy.

3. **Which reported lists the order reaches.** `pickable` — and so the wave's
   batch, `TickContext.pickable`, `pickableAfter`, each refill. Left in the
   default order: `quarantinedTags`, `claimedTags`, `refusedTags` (the hook is
   handed the ready set alone, so an entry a hold took was never offered it),
   and `TickResult.entries`, which reports outcomes rather than a selection
   (`src/waveTick.ts`). If a chain should read either in its own order, that
   is a spec sentence, not a patch.

**Seam widened beside it:** `TickLegContext.selection` (`src/tickLeg.ts`) took
five positional args and needed a sixth (the in-flight set). Now one options
object; `Dispatcher`, `runFanout` (three sites) and the preview updated. No
behavior in that move.

The engine calls the hook even over an empty ready set — "every selection"
read literally. Harmless for a pure policy, but a call a chain can see.
