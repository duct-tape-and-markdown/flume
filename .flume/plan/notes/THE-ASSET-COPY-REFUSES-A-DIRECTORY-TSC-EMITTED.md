# The asset copy classifies from the source, not from the emit

Shipped: `scripts/pack-harness-assets.mjs` now classifies every candidate
directory before it writes anything, and refuses one carrying a TypeScript
module at any depth, naming the directory and the module.

Two things the next plan tick may want:

- **The emit cannot answer the question.** The obvious check — "does
  `dist/harness/<name>` already exist after tsc?" — is wrong, because the
  build never cleans `dist/`, so a second `pnpm build` sees the previous
  asset copy's own output there. The classification therefore reads the
  source tree (a `.ts`/`.tsx`/`.mts`/`.cts` that is not a declaration file),
  which is what tsc reads too.
- **The refusal is the whole remedy; no merge path exists.** If the package
  ever wants a directory holding both modules and assets, the copy has to
  learn to merge asset files into an emitted directory instead of replacing
  it, and the destructive replace (which exists so a renamed asset cannot
  survive an incremental emit) would need a different mechanism. The refusal
  message names both exits so nobody has to rediscover the fork.

Debt observed: the script grew a second optional positional, `sourceDir`,
whose only caller is the suite — symmetric with `outDir`, whose only caller
is also the suite (`pnpm build` passes neither). Both exist so the refusal
and agreement cases run the real writer over a tree the test authored. If a
third knob ever lands for the same reason, the script probably wants a named
options parse rather than positional slots.
