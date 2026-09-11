# The shipped examples trail the reference chain's shape (human)

`examples/*-chain.ts` and `examples/prompts/*` are what npm ships
(`package.json` `files`). They load and run one tick under
`tests/examples.integration.test.ts`, so they work — but none shows plan
split into slices with `shouldRun` computed from disk, a dependency-ordered
ladder, `tests[]` judged by a reporter-fed gate, or `GateContext.entry` /
`baseSha` in use. The chain that does is `.flume/chain.ts`, which does not
ship. Either `examples/` gains a chain carrying the current shape, held by
the same integration test, or `docs/CHAIN-AUTHORING.md` names
`.flume/chain.ts` as the reference and the examples as deliberately
minimal. Decision needed.
