# The order's two unpinned edges

`harness/order.ts` ships the four keys. Two things the tree does not hold:

**`blockedBy` carries no cycle check at parse.** `queueForestErrors`
(`src/PendingSchema.ts`) refuses a `parent` cycle; nothing refuses
`A blockedBy B, B blockedBy A`. Both walks in `harness/order.ts` are guarded
so they terminate, and nothing in such a cycle is pickable, so the order never
serves on the claim — but the queue parses, `flume status` reports both
entries, and the only signal is that neither ever ships. Cheap to refuse at
the schema (the forest walk already runs there); not this entry's scope.

**The order reads a graph it cannot drive the real composer of.**
`blockedByGraph` is private to `src/selection.ts`, so
`tests/harnessOrder.test.ts` composes `OrderContext.blockedBy` off its fixture
queue by the same rule. Two spellings of one rule, and a change to the
engine's would leave these cases green
(`.claude/rules/engineering.md`, *A seam gate reads what the real writer
wrote*). The engine-side pin exists (`tests/Dispatcher.test.ts`), so the gap
is the composition rule rather than the hook's wiring, which
`tests/harnessChain.test.ts` pins by identity. Reporting the graph on a
surface a test can read would close it.

**One shape call made at the site.** `standingGoals` is now exported from
`harness/goals.ts` with the block, since the operator's goal order has two
readers. Its header says so. If a third reader appears, the ordering wants its
own file.
