# The cascade tests[] gate: two gaps left standing

1. **The refusal drives the wrapper, not the shipped gate object.**
`judgedByEntryTests` is exported and driven over a stub suite gate whose
`details` carry a hand-authored report; the shipped gate can't be driven
because its inner `shellGate` spawns `pnpm vitest`. Wiring is pinned
separately on the shipped object (`when === "afterMerge"`, `command`
contains `--reporter=json`), so the claim is two pins, not one. Same
posture `tests/chain.test.ts` takes for `judgeVitestReport`. Closing it
would need a suite-result injection point — not obviously the engine's
business, so filing it is plan's call.

2. **`examples/prompts/build.md` never states the title discipline.**
The `asserts`-line-verbatim contract now renders into cascade's *plan*
prompt via `entryExtension.tests.hint` + `renderSchemaForPrompt`. Build's
prompt receives only `ENTRY_JSON`, so a cascade build agent sees `tests[]`
and is told nothing about titling a passing test with it — it learns the
rule from a gate revert. `examples/prompts/build.md` is outside this
entry's fence; one sentence there would close it.
