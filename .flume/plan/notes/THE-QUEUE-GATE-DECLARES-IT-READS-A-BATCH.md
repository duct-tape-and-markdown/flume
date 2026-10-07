# chainLoadGate is now the last builtin withholding the batch declaration

Shipped as written: `pendingGate` returns a `BatchingGate`, its two touched-path
helpers take the context union, and `docs/CHAIN-AUTHORING.md` states the
declaration in its own bullet under *Reading a batched merge*.

Observed while re-reading the neighbourhood: the same argument that bought
`pendingGate` the declaration holds for `chainLoadGate` verbatim. It reads
`ctx.touchedPaths`, `ctx.repoRoot`, `ctx.configDir` and `ctx.flumeDir` and
nothing else (`src/builtinGates.ts`) — four facts a `BatchGateContext` states
in full, none of them per-span. Its judge is "did this merge's tree touch
chain.ts, and does the committed file load", which over a batch is the right
question asked once over the union. So the prose reason the docs now give for
it withholding — "it judges the gated commit as one span's" — is the same
sentence that was wrong about `pendingGate`, and this entry's `per`
(`spec/worktrees.md`, *Batched merges*) covers it equally.

Not built here: this entry's `pins[]` names the chainLoadGate narrowing as a
property that holds, so flipping it in the same tick would have contradicted
the entry. It is plan's call, and the pin I shipped
(`tests/gateBatch.test.ts`, "a phase whose afterMerge gates include
chainLoadGate still merges one span at a time") is the case that would have to
be rewritten, not merely re-greened — worth naming in the entry if it queues.

No width changed in this repo: `harness/gates.ts` hangs the `afterMerge` copy
of `pendingGate` on the plan slices only, which are singleton, and `build`
takes the `afterCommit` copy alone.
