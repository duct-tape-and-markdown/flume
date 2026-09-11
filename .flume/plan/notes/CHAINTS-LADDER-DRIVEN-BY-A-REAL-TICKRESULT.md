# The build wave is the half still folded by hand

Shipped: six real `Dispatcher.tick()`s drive every plan-slice rung
(tests/chain.test.ts, "the plan ladder over a real tick"). The two
plan-slice legs they replace were deleted; what survives in
"handoff — the legs a hand-built TickResult still owns" is what a real
tick cannot produce on demand.

Declared debt — `build.handoff` is still judged off `tickResult()`:
`entries[].mergeOutcome` ("not-shipped" vs "cherry-pick-conflict"),
`shippedTags`, and the ladder-after-a-clean-wave legs. That is the
richest slice of engine vocabulary this chain reads, and it is the one
nothing pins against the real writer. Driving it needs a fanout tick:
a real worktree, `build.setupWorktree` (a `pnpm install`), and the
vitest gate — off the fast lane. The fork is plan's: a slow-lane suite
(`examples.integration.test.ts`-style) for one build wave, or accept it.

Gone with the deletions: the derive-committed-nothing-pickable
hibernate leg. Both `nextPhase` answers are covered by the new drive,
just not from a committed derive tick.

A plan slice reports four gates, not three: the engine's own
`writable-paths` lands beside the chain's.
