# The spawn-budget scan flags a case for naming an identifier, not for spawning

`scanDefaultLaneSpawnSites` (tests/helpers/spawnBudget.ts) propagates through
*names*: `make` in Gate.test.ts's "the same shellGate body works in either
lifecycle slot" binds an arrow carrying `cmd: "node"`, so a sibling case whose
body merely references an identifier spelled `make` is flagged as a node
startup and reverts on the missing budget. The new roster case destructured
`([name, make]) => ...` over its factory table and tripped it; renamed to
`construct`.

The helper declares the over-approximation deliberate and prices it at "one
declared ceiling it never pays" — but this case spawns nothing and runs in
3ms, so declaring SPAWN_BUDGET_MS on it would have been a false claim about
the case rather than a cheap one. The propagation is file-scoped and
name-only, with no scope analysis: a local parameter collides with an
unrelated sibling's binding. Worth deciding whether the reach should be
bounded by the scope a name is actually visible in.
