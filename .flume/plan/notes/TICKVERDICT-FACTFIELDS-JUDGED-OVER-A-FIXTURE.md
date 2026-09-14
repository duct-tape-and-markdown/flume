# Three TickVerdict fact fields no real tick in the suite emits

The key-set claim now unions two dispatcher-produced verdicts (a fanout
wave that ships one entry, reverts one on the real writable-paths gate,
declines a third, retires a stale prior attempt, and checkpoints an
unstaged bystander; plus a quiet singleton). That reaches 15 of the 18
names `TickVerdict` declares.

Still unreached by any real writer in this test: `tipMoved`,
`provisionFailures`, `mergeFailures`. Each is asserted individually
elsewhere in tests/Dispatcher.test.ts, but none of those assertions is a
key-set judge — so if the engine grew an undeclared field on *those*
paths alone, the allowlist check would not see it. Widening the union
needs a tick that races the trunk ref and one whose worktree provisioning
fails, both contrived setups; filed as debt rather than built here.

Also observed: the suite's other verdict tests (round-trip, clear,
bounded history) still drive `verdictFixture`, correctly — they judge the
primitives' behavior, not the shape's vocabulary.
