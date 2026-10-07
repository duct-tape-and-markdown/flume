# One subtree walk, and the surface it did not reach

Landed as specified: `subtreeOf` + `SubtreeEntry` + `isGoal` in
`src/PendingSchema.ts`, `descendantsOf` as one call of the walk,
`harness/goals.ts`'s `descend` and local `isGoal` gone, `src/queueGoals.ts`
and `harness/gates.ts` on the export. Whole suite green; the goals block,
`harness/order.ts`'s served order and the goal-rank gate print and refuse
exactly what they did.

Three things for the next derive.

1. **Neither export reaches `src/index.ts`.** `harness/` imports both
through the relative module path, as it already did for `descendantsOf`, so
the export pin is satisfied by the cross-module reference and a downstream
chain still cannot reach the walk at all. The entry's `per` cite is about
facts reaching a surface a chain reads; that is only half done here, and
widening the package's public surface was not in the entry. Candidate
entry: add `subtreeOf`, `SubtreeEntry`, `isGoal` and `descendantsOf` to the
`exports` map's reach, or rule that the forest stays package-internal.

2. **`descendantsOf`'s output order changed and nothing pinned it.** It was
a stack-pop descent, documented as carrying nothing; it is now pre-order
depth-first in listing order. Three callers put that order in front of a
reader — `src/waveTick.ts:723`, `src/Dispatcher.ts:1606`,
`harness/gates.ts:733` (the records gate's step list). Each prints a tag
list with no test over its sequence, so a reported order moved silently
this tick. Fileable as a pin, one per reporting site.

3. **One index per goal, not per queue.** `standingGoals` used to build the
children map once for the whole queue; `subtreeOf` builds its own per call,
so the cost is now goals x entries. Irrelevant at queue sizes and the
simpler shape, but it is the only thing the collapse paid for — worth a
hoisted-index overload only against a measured cost, never speculatively.
