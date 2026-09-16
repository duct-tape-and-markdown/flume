# The decisive reason a pilot declined the package is expressible today and documented nowhere (pilot follow-up from a win32 consumer with a multi-job bay, relayed by the operator)

The pilot's bay is one chain and many jobs, each with its own gates, agents,
setup dirs, fence, capabilities and autonomy — every column varies. They
read `harnessChain({ api, declaration })` as one declaration per
repository and stopped there. Verified: a job's chain loads with the job's
state root as `api.paths.flumeDir`, `parseDeclaration` is exported, so a
five-line `chain.ts` reads a per-job JSON declaration under the package's
strict schema. Their second reason, that splitting a schema-plus-hint entry
contract across package prompts and a consumer schema reintroduces drift,
is answered by the same mechanism: consumer `entryFields` are the engine's
entry extension and render into the package prompt. Their third, a restore
that must serialize across a wave for a cold shared cache, was the one real
knob missing.

Ruled at `spec/harness.md` *What a consumer declares* (the declaration is
a value; a bay hands one per job), *The entry extension* (a consumer's
field renders like the package's), and the `setup` row (`serialize`).
What derives: the knob, and the adoption docs saying all three.
