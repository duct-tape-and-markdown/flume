# The embedder's half of maxParallel stays unvalidated, and the spec states a degradation that is already gone

Shipped: the chain-declared `supervisorPolicy.maxParallel` joins the counted
roster, so zero, negative and fractional refuse at load. Two things the next
plan tick may want to route.

**spec/pending.md, *Fanout partition — disjoint touched paths* describes a
degradation this tree does not have.** It says a non-positive `maxParallel`
"satisfies no batch's capacity test, so every entry opens its own batch and
the wave runs a single entry rather than refusing". The partition half still
behaves that way, but the wave is slot-driven now: `fillSlots`
(`src/waveTick.ts`) opens slots `while (inFlight.size < maxParallel)`, so zero
runs *no* entry, not one. The sentence was true of the batch-driven wave. It
also now reads stale on the refusal half for a declared value. Both are a
human spec edit — a build tick cannot touch `spec/`.

**The embedder's knob is still silent.** `DispatcherOptions.maxParallel`
(`src/Dispatcher.ts`) defaults to 4 and is read only where the chain declared
nothing (`src/selection.ts`), so a programmatic embedder passing 0 gets
exactly the quiet no-op this entry removed. I did not widen the load check to
it: the loader validates a *declaration*, and the embedder's value never
passes through `loadChainModule`. If that gap is worth closing it belongs at
the dispatcher's constructor, where `?? 4` already lives, and it is a separate
entry with its own cite. Same shape for `maxTicks`/`mergeBatch`, which have
the same split.

**Also touched, beyond the entry's two files:** the `maxParallel` hover text
(`src/Phase.ts`) and its bullet in `docs/CHAIN-AUTHORING.md` each state the
refusal now, matching how `maxTicks` and `mergeBatch` already read there — the
authoring page is the surface a chain author reads before the hover text, and
leaving it silent would have been the only statement of the knob that still
claimed anything goes.
