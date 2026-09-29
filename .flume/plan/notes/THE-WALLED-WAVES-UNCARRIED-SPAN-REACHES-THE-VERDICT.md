# The walled wave's span reaches the verdict and no other surface

Shipped as filed: `wave-walled` joins `MergeOutcome`, and the walled leg's
fold (`foldUncarriedAttempt`, `src/waveMerge.ts`) pushes the base/head pair
for an attempt that committed behind the wall.

Two things plan may want.

1. `foldAttemptFacts` lost its last cross-module consumer in this commit —
the walled leg now calls the wrapper — so it was un-exported in the same
change (`engineering.md`, *An export earns its consumer*). Nothing else
changed about it.

2. The new row reaches the verdict and nothing else. The per-entry
`mergeOutcome` (`src/Phase.ts`) is mapped at the end of `runFanout`, and a
walled wave throws `WaveLedgerRefusal` before that line, so no `handoff`
ever sees a `wave-walled` entry — by construction, since the tick failed.
That is consistent, but it means the union now has one member no chain hook
can observe. If a future entry wants the walled wave's per-entry records on
`TickResult`, the fix is the throw site carrying entry outcomes the way it
already carries the verdict, not a second fate vocabulary.

Also noted: no spec file enumerates `MergeOutcome` (`spec/chain.md` is an
ellipsis, `spec/loop.md`'s verdict section names the pair but not the
kinds), so the union's roster lives only in the doc comment over the type.
That is fine for now — the doc is engine surface reachable from the exports
map — but it means a kind added without a `per` cite has no spec sentence to
answer to. Not filed; stating it where plan can decide.
