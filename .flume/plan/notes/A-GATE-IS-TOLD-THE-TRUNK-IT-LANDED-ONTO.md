# CHAIN-AUTHORING still tells chain authors a singleton never gates afterMerge

Setting `landedOnSha` meant touching both afterMerge gate-context builders,
`src/waveTick.ts` and `src/singletonTick.ts`. The second contradicts
`docs/CHAIN-AUTHORING.md` (*Writing a custom Gate*), which still reads
"Singleton phases never run `afterMerge` (they commit straight to the
trunk)". A singleton has run in a worktree and reached the cherry-pick +
afterMerge stage since `spec/worktrees.md` *Singleton runs in a worktree*,
and `GatePhase` (`src/Gate.ts`) already says so. Verified on disk this tick:
`runSingleton` filters `phase.gates` for `when === "afterMerge"` and runs
them on trunk. A chain author reading a rule the engine stopped holding —
expired narration in the sweep's docs reach.

Second, smaller: no doc page enumerates `GateContext`'s span fields.
`baseSha` reached authors only through `docs/MIGRATING-0.15.md`, and
`landedOnSha` has no migration page yet (0.16.1 is current). Worth a line
at the next cut.
