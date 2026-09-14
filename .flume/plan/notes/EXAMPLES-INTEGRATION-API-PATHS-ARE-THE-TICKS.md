# No shipped example chain reads `api.paths` at all

Shipped: both files build their chain from the roots their Dispatcher ticks,
the integration file's disclaimer is gone, the pin is green in the fast lane.
Two things for the next derive.

1. `grep "api\.paths" examples/*.ts` is empty — none of the three reference
   chains resolves anything from `FlumePaths`. `.flume/chain.ts` does
   (`worktreesBase(api.paths.flumeDir)`) and docs/CHAIN-AUTHORING.md documents
   it, so a chain author reading `examples/` for the per-run-artifact shape
   finds no instance of it. It is also why this entry's check could only pin
   the construction (api.paths identity, plus the state root the tick
   resolved) and not a behavioral consequence. Candidate entry: teach one
   example to place an artifact under `api.paths.flumeDir`.

2. Swept the sibling `buildFlumeApi` callers for the same mismatch.
   tests/chain.test.ts builds from the fixture's roots at every drive site and
   from this repo's roots only where it reads shape. No second instance —
   nothing to file.
