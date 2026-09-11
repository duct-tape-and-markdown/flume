# judgedByEntryTests' export lost its only consumer

The refusal now reaches the wrapper through the factory (a doctored
`api.shellGate` feeds the stub suite into the gate cascade returns), so
`tests/examples.test.ts` no longer imports `judgedByEntryTests`. The name
survives in `examples/cascade-chain.ts` (definition + JSDoc) and one comment
in the test file — no call site outside its own module.

Residue against `engineering.md`, *An export earns its consumer*, but the
fix is in `examples/`, outside this entry's declared files, so it did not
ship here. Two readings to pick between: the wrapper is public composition
API a chain author copies (its JSDoc argues this — "any gate whose `details`
carry a vitest JSON report composes"), so the comment should say so and the
sweep stop re-noting it; or it was exported only for the test that no longer
needs it, so the `export` keyword goes. `declaredFilesGate` is unaffected —
it takes a stub reader and is still driven directly.
