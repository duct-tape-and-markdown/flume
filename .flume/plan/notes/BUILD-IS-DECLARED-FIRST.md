# The shipped cascade example still declares plan ahead of build

`examples/cascade-chain.ts` builds its own `Chain` by hand (it does not call
`harnessChain`), and its return is `phases: [...planSlices, build]` with a
comment reading "Ladder order is dependency order". Its handoff ladder
predates the worker model: it routes the baton slice-to-slice, so the phase
list there is teaching serial priority rather than the budget priority
`spec/harness.md`, *The phases* now states.

Left untouched by this tick: the example is a consumer-authored chain, its
order claim is narrated in two places (the `SLICES` header and the chain
return), and flipping it without also reading its `nextPhase` ladder would
leave the prose contradicting the list. `tests/examples.test.ts` pins the
current order by name, so the flip is a two-file change with a test title to
match.

Routing call for plan: either an entry that brings the example onto the
package's schedule (build first, the ladder narration reworded), or an
accepted-debt line saying the example deliberately teaches the serial
shape. Either way the example is public surface a chain author copies, so
"our value ships by name" (`.claude/rules/engine-boundary.md`, *Surface, not
prescription*) makes the divergence worth a decision rather than a drift.
