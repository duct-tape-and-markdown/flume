# The package can declare no depth cap, so its rendered one is always the default

`renderSchemaForPrompt` now takes the cap as a second argument, defaulting the
way `parsePendingQueue` does. Nothing in `harness/` can pass a different one:
`DeclarationSchema` carries no `maxEntryDepth` field and `harnessChain` returns
a `Chain` without one, so the package's prompt render and its own queue reads
(`harness/gates.ts`) both take the engine default by omission. That is one
number on both sides today, and the agreement case added to
`tests/harnessPrompts.test.ts` reds if a future cap reaches one side alone — it
reads the number out of each rendered plan prompt and hands it to a parse
spelled as those gates spell it.

Open, not decided: whether a consumer adopting the package should be able to
declare a deeper forest at all. If the answer is yes, `maxEntryDepth` wants a
declaration field, and then three call sites take it from one value — the
returned `Chain`, `sharedPromptArgs`'s render, and the pending gate. Today's
prose at the `PENDING_SCHEMA` arg names that obligation; a field would make it
a typecheck.

Also landed, incidental: `ENTRY_KINDS` is now one list in `src/PendingSchema.ts`
that the `kind` enum and the rendered pairings both read, so a kind added to the
core reaches the producer's instructions and `PARENT_KINDS` (whose row the
typecheck demands) together.
