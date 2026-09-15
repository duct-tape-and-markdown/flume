# The sibling QUESTIONS_PATH title carries the same exposure

Retitled only the `PLAN_STATE_PATH` case, as filed. The helper it calls,
`everySliceOverWrongKindAt` (tests/harnessPrompts.test.ts), is conditional
*by construction* for every key it is given: each slice's verdict is the one
its own spans entail, refusal or clean render.

So the second caller at tests/harnessPrompts.test.ts:499 — "every plan slice
prompt refuses when its open-questions artifact is a directory in place" —
states an unconditional refusal for the same reason the plan-state title did.
It reads true today only because all three of `plan-inbox`, `plan-derive` and
`plan-sweep` happen to open a `QUESTIONS_PATH` span; the moment one stops,
that title claims a refusal its body asserts the absence of, and nothing goes
red. Same section, same shape, one `it` line apart.

Left alone here because the entry named one edit and framed the sibling as
currently true — but it is a fact-shaped title over a conditional helper, not
a claim the body makes.
