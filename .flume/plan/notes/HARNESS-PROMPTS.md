# Prompts shipped; the factory owes them a per-tick arg set

**1. The per-tick args are a contract with no supplier yet.** The shipped
prompts name `ENTRY_JSON`, `PER_PATH`, `PER_SECTION`, `PER_SECTION_TEXT`,
`NOTE_PATH` (build — repo-relative; the park warning depends on it) and
`SPEC_WINDOW`, `SWEEP_WINDOW`, `RECORDS`, `BUILD_RECORDS` (slices). Nothing
supplies them until the chain factory lands; the renderer refuses loudly on
a missing arg, so this is visible, not silent. `tests/harnessPrompts.test.ts`
derives that set from the files, so the factory entry reads it off a render.

**2. `plan/open-questions.md` has no path owner.** The queue's path is the
engine's, the plan state's is `planState.ts`'s, the record queues' are
`records.ts`'s — this one I spelled in `harness/prompts.ts`
(`QUESTIONS_REL`), declared and cited, because the prompts are its only
reader. A plan-artifacts module should take it if one appears.

**3. `declaration.slots` gained its consumer.** `{{DOMAIN}}`/`{{AUTONOMY}}`
render into all four phase prompts; the wrapper rides the value, so an
undeclared slot costs zero bytes.

Packing to `dist/harness/prompts/` is still HARNESS-PROMPT-PACKING's.
