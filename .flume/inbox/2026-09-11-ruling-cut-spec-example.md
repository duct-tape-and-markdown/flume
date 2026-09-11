# Ruling: cut examples/prompts/spec.md and cascade's spec phase (human)

Closes *examples/prompts/spec.md models a retired consumer shape*. Cut
both together: the prompt, and the `spec` phase in
`examples/cascade-chain.ts` with its `specs/active` / `specs/_aligned` /
`workshop/_archive` partition. The example then models the shape flume's
own chain runs — plan and build. `tests/examples.integration.test.ts` keeps
the example loading and ticking; adjust its expectations only where they
named the removed phase. One entry.
