# docs/CHAIN-AUTHORING.md quotes cascade's slicePhase with nothing pinning the copy

Shipped as filed. Two things the next derive should see:

1. `docs/CHAIN-AUTHORING.md` (§ "Declaring phases", ~line 190) carries a
   verbatim copy of `examples/cascade-chain.ts`'s `slicePhase`, fence
   included. Rooting that fence at `api.paths.stateRootRel` meant editing
   the doc copy by hand; nothing would have failed if I hadn't, so the
   flagship example and the walkthrough that teaches it can diverge silently
   (`engineering.md`, *A seam gate reads what the real writer wrote* /
   *Derived state is computed, never restated beside its source*).
   Correctness-adjacent: the doc is what a chain author copies.

2. The entry named `tests/examples.test.ts`'s whole-object `toBe` as the
   only identity re-pin. There was a second: `tests/Dispatcher.test.ts`
   (~12466) `toEqual`s a chain-recorded `api.paths` against the three roots.
   Re-pinned there with the offset. Its sibling (~12426, relocated root
   outside the repo) still passes only because JSON drops the `undefined`
   key — an absence nothing asserts.
