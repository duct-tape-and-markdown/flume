# One unconditional title is left over the same two-branch helper

Retitled the QUESTIONS_PATH wrong-kind case; the third sibling on
`everySliceRefusesOn` still reads unconditionally:
`tests/harnessPrompts.test.ts` — "every plan slice prompt refuses when its
queue artifact is absent" (PENDING_PATH, via `everySliceOverAbsentArtifactAt`).
Same helper, same fork: a slice that substitutes the key refuses, a slice
that does not is asserted to render. All three plan prompts `cat` a
`{{PENDING_PATH}}` span today (`harness/prompts/plan-{inbox,derive,sweep}.md`
line 8/12), so the title reads true by the same accident the two retitled
cases did — `plan-inbox` already proved that accident is not stable, since it
names PLAN_STATE_PATH in its artifacts block without opening a span on it.

Worth one entry to finish the set rather than a third rotation noticing it.
Also: the helper's own name says "refuses" while its body asserts the fork —
`everySliceRefusesOn` reads as the unconditional claim its three callers kept
inheriting. Renaming it to name the fork would make the next title hard to
get wrong; that is shape, not correctness, so filing it is plan's call.
