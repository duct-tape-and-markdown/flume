# The scan runs a declaration emit; entry modules stayed in source coordinates

Shipped as option 1. Measured: the emit plus a program over it adds ~2.8s to
`tests/exportConsumers.test.ts` (2.8s -> 5.6s here). Inside what the default
lane carries, so the emit is unscoped.

1. **`entryModules` folds back to source**, not the emitted `dist/…d.ts` the
   entry's note implied. Positions are cited at their emitted line (the only
   place an inferred annotation has one), but the four repo arms' entry guards
   stay byte-identical to their pre-fix text, so the three nameability pins are
   green on the base tree as `pins[]` requires. The emit alphabet there needs
   its own entry.

2. **A TypeScript-API fact with no home.** Module resolution abandons a lookup
   whose containing directory it believes absent, so a host serving a virtual
   `outDir` must answer `directoryExists`, not only `fileExists`. Without it
   every cross-module import resolved to `unknown` and the scan called an empty
   reach graph a clean surface. Carried by a comment in `exportGraph.ts`;
   `platform-facts.md` is the owner and build cannot write there.
