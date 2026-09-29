# The load's answer needed a type of its own, and spec/chain.md still types the old one

Shipped as filed: `loadChainModule` evaluates `Chain.worktreesBase` beside its
four other declaration validations, and both dispatcher sites read the string
off the loaded module.

**One spec line to settle (human's).** `spec/chain.md`, *The chain is a plugin,
not a consumer* types `DispatcherOptions.chainLoader?: () => Promise<ChainModule>`;
it is now `() => Promise<LoadedChain>`. I did not put the resolved base on
`ChainModule` because that same bullet enumerates `ChainModule` as
`{ chain; agent?; forkResolver? }` — a factory's return — and a factory that
filled a `worktreesBase` field would have it silently dropped by the load that
composes the module. `LoadedChain extends ChainModule` keeps the factory
contract exactly as spec states it and leaves only the loader's type stale.
Both readings were defensible; the spec sentence that is now wrong is the one
spec calls "in-process test injection only".

**`worktreesBase` is required-and-nullable on purpose.** The field is the
load's *report*, so a loader that never evaluated the declaration must not
typecheck as one that found none. That bit immediately: a pre-existing case,
"the startup sweep reads the chain-declared base", declared a base through the
`staticLoader` seam — after the move, the declaration was nobody's to run and
the case would have gone vacuously green on the default base. Four dispatcher
cases (three placement, one sweep) now write a real `chain.ts` into the
fixture's config dir and drive `diskChainLoader`; nine inline test loaders
gained an explicit `worktreesBase: undefined`.

**Observed, not filed.** `resolveWorktreesBaseDeclaration` is now module-private
in `src/chainLoad.ts` — the one caller is the load. The comments in `src/paths.ts`
and `harness/declaration.ts` that cite it by name still resolve and now read
true, as the entry predicted.
