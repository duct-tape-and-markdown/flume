# May a consumer adopting the harness package declare a deeper forest, or is `maxEntryDepth` the package's fixed opinion?

`spec/harness.md`, *What a consumer declares* — the fork is whether the
declaration table gains a `maxEntryDepth` row.

Observed on disk 2026-10-07, draining the note from
`THE-RENDERED-SCHEMA-STATES-THE-FOREST-RULES-THE-PARSE-ENFORCES`. The engine
offers the knob: `Chain.maxEntryDepth?: number`, default `4`, read by every
queue parse (`spec/chain.md`, *`Chain.order` — the queue's sequencing policy*,
closing line). The package
hides it — `DeclarationSchema` carries no such field, `harnessChain` returns a
`Chain` without one, and so both the prompt render (`harness/prompts.ts:291`,
`renderSchemaForPrompt(extension)`) and the package's own queue reads
(`harness/gates.ts`) take the engine default by omission. One number on both
sides today, and `tests/harnessPrompts.test.ts:1560` reds if a future cap
reaches one side alone.

What makes it a question rather than an entry: the declaration table is the
roster of what a consumer may say, and a row in it is the human's sentence to
write. The precedent points one way: `supervisor` is passed through whole, "declared
here so one file holds the environment and no knob is lost behind the factory",
and `maxEntryDepth` is exactly a knob the factory currently loses. Against that: depth is not an environment
fact like `shell` or `worktreesBase`; it is a statement about how finely plan
may decompose, which the package's own prompts and goal/epic vocabulary already
fix at four.

Options:

- **Pass it through, like `supervisor`.** A `maxEntryDepth?: number` row on the
  declaration table. Then one declared value reaches three call sites — the
  returned `Chain`, `sharedPromptArgs`'s render, and the pending gate — and the
  obligation today's prose states at the `PENDING_SCHEMA` argument becomes a
  typecheck rather than a sentence a future caller must read
  (`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
- **Declare it fixed, and say so.** No field; the package states in
  *What a consumer declares* that the forest is four deep because its
  prompts name four levels, and a consumer wanting more writes its own chain.
  Cheapest, and it makes the current silence deliberate rather than an omission.
- **Leave it silent.** Today's shape: a consumer discovers the cap is
  unreachable only by reading the factory. This is the one option no sentence
  defends.

A ruling either way is one spec sentence; the code follows it in one entry.
