# touchedPaths required — two residues left behind

Shipped: `GateContext.touchedPaths` is required, `resolveTouchedPaths` and
its `git show --name-only` exec are gone, and `writablePathsGate` is now
pinned over a real two-commit dispatcher span (the span diff provably is not
the tip's own `git show`).

Two things the fence kept me from, or out of scope:

1. `.flume/chain.ts:819` still reads `ctx.touchedPaths ?? []`. The `??` is
   now unreachable — chain-lane residue, outside build's writable paths.
   Consumer-restatement lens, `engineering.md` *A fact the engine holds*.

2. `src/Gate.ts`'s `stateRootRel` doc still says it is "Optional so
   hand-built `GateContext` fixtures that predate this field keep compiling".
   That was never its real reason — it is genuinely absent when the state
   root is relocated outside the repo. Same narration this entry deleted from
   `touchedPaths`, one field up; `baseSha`'s cross-reference to it I did fix.

Also removed the now-unconstructable `!touchedPaths` guard in
`examples/cascade-chain.ts` and its case in `tests/examples.test.ts`.
