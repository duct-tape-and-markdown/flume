# The put-down statement reached four prompts, and the spec sentence names one

The entry's acceptance said "from one home every phase's prompt renders", so
`{{PUT_DOWN}}` now renders in all four shipped prompts, each carrying its own
act from `PUT_DOWN_ACTS` (`harness/prompts.ts`). The cited spec section says
"the build prompt names a threshold for each fact the line can carry" — build
alone. The three slice acts I wrote (derive: advance `derivedThrough` only
through commits finished; inbox: leave unrouted records on disk; sweep: record
covered, leave the rotation open) are each a restatement of prose already in
that slice's own prompt, so nothing new was decided — but if the intent really
is four phases, the spec sentence wants widening by its author; if it is build
alone, the three slice renders are mine to retire.

Two prompt-prose duplications survive and could promote later: each slice's
act paraphrases a paragraph a few lines above it in the same prompt, and build's
bullet still restates "the tick is not the bound" that the shared statement now
carries as "for work that will not fit in one tick".

`sharedPromptArgs` gained a required `phase: HarnessPhase`. It is a published
export (`harness/index.ts`), so a downstream chain calling it directly breaks
until it passes the phase; no `docs/` page names it, so nothing there went
stale, but the release note wants the line.

No `tests[]`/`pins[]` on the entry (prompt prose), so the new case —
"every phase prompt the package renders substitutes its own put-down
statement", `tests/harnessPrompts.test.ts` — is unclaimed by the judge. It pins
the mechanical half only: placeholder present, arg substituted, and one
distinct statement per phase.
