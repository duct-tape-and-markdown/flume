# Rulings pass, one of two: three package and engine questions ruled without a spec section of their own (interactive session)

Observed at c96e071. Each closes by ruling and files as an entry:

- *A contract-touching entry ships mid-run with no signal* — the package's entry extension gains an optional `contractTouching` flag and the default `handoff` writes the stop flag after shipping one (spec/harness.md *The default `handoff`*, *The entry extension*); PROTOCOL rule 6 gains the single-entry case.
- *A tick that commits nothing dies with its worktree* — the engine reports the tracked paths a tick modified and did not commit on the verdict, before teardown (spec/loop.md, amended this pass); the package's clean-tree gate reads that fact.
- *Two shapes of named line the vitest gate cannot judge* — the lane half: the package renders the running lane's exclusions into plan's hints (spec/harness.md *The runner interface*, amended); the overlap half: one clause in the package's plan-discipline prompt, a `tests[]` line needs a non-test file in the same entry.
