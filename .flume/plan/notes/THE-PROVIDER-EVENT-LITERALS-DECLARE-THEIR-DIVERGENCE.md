# The adapter's own flag literals are the same shape, one rung weaker

Shipped: all five provider-event literals now declare the divergence at their
site (`tests/budgetHook.test.ts`, `tests/agentBudget.test.ts`), citing
*Derived state is computed, never restated beside its source* for what they
diverge from and *A seam gate reads what the real writer wrote* for why the
divergence is the right depth.

Observed in the same neighborhood, undeclared: five hand-spelled flag
literals against the argv constants they restate —
`tests/agentBudget.test.ts:109-111` spells `--context-window`,
`--every-calls`, `--thresholds` inside expected command substrings, and
`tests/budgetHook.test.ts:158,181` spells two of them as refusal input.
Their constants (`CONTEXT_WINDOW_FLAG` and its two siblings,
`src/budgetHook.ts`) are module-private, so a test cannot import them: the
fold a sweep would propose is not available, which is a *stronger* warrant
than the event name's and stated at no site either.

One difference worth plan's judgment before it files: the flag vocabulary is
flume's own on both sides of that seam, not the provider's, so a rename
landing on both sides simultaneously is legitimate rather than a silent
break. The event name's warrant — the hand spelling is the only thing holding
production in agreement with an external party — does not transfer verbatim;
the warrant there is "a literal is what proves the renderer emitted the flag
it declared, and the constant is unreachable from the suite regardless."

The refusal-input literals (`:158`, `:181`) are outside the agreement claim
entirely per that same section's scope line — a refusal test keeps its
hand-authored input — so if this family is filed, it is the three substring
assertions, not the five sites a grep turns up.
