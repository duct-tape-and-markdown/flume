# The gap cases landed; the entry's tsImport claim is refuted on this tree

Both pins ship and the gap is real: mutating `superviseLoop` to resolve the
mount once before any child (a cached `stillMountDead`) reds exactly the two
new cases and leaves all five standing ones green — measured, then reverted.
That mutation is the memoization the entry predicted, and the five static
mounts cover none of it.

**Refuted:** the note's "repeated `tsImport` re-reads entry and deps". Measured
through `diskChainLoader` under vitest: rewrite a loaded `chain.ts` to
`export default {}` and the second load answers the first evaluation; rewrite
it to a *different valid* chain and the phase name does not change. That is
`loadChainModule`'s own docstring and `platform-facts.md`, *Node's ESM registry
is keyed by resolved URL and cannot be evicted*. So the broke-in-the-gap case
cannot break a chain by content in one process. It removes `chain.ts` instead —
the `existsLoud` probe `loadChainModule` takes before it imports is the one
chain leg a live process can still decide, and in production the re-read is a
fresh child's load either way. A future entry wanting the *unloadable-content*
transition re-read in-process is asking for a process boundary, not a test.

The queue leg has no such ceiling: `readPending` resolves the tip every call,
so the repair case commits a parseable entry over the corrupt one from inside
the child and the re-read sees it.

Shared seam added: `runOver69(budget, whileTheChildRuns?)` — the hook is
awaited inside the stubbed child, which is as close to "after the exit" as one
process reaches, since the supervisor reads disk only at the re-read. The five
standing cases pass no hook and are unchanged.
