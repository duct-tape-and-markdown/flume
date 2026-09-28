# The discipline's absence-is-a-state claim was stale before the roster was

Shipped: the plan-state bullet in `harness/prompts/plan-discipline.md` now
names `retiredThrough` beside `sweptThrough` and `rotation`.

Two things the entry did not name, found while editing:

1. The bullet also asserted "`drainedRuns` is the one field absence is a
   state in". That was already false — `retiredThrough` is optional and
   absent reads as the stamp (`SweepStateSchema`, `harness/planState.ts`) —
   and naming the cursor without fixing it would have left the page
   contradicting itself one sentence later. Rewritten to name both fields
   and what each absence means.
2. The drop is not silent, contrary to the entry's premise: the slice-state
   gate refuses it while the stamp stands
   (`retiredClaimsStayRetiredWhileTheStampStands`, `harness/planState.ts`).
   The bullet now says so, so a slice reads the refusal before it earns it
   rather than after.

`harness/prompts/plan-sweep.md` already named the field for its own slice, so
the gap was the shared page alone. No property pinned: a completeness read
over harness prose is fenced by `engineering.md`, *Narration is the ladder's
bottom rung*. Worth noting the same completeness class is open for the other
two slices — nothing mechanical holds this roster against
`PLAN_STATE_SHAPES`, and this drift is one instance of it.
