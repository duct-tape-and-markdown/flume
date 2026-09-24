# The two test-side spellings are the pin, and must stay literals

`HOOK_EVENT_NAME` now lives in `src/budgetHook.ts` beside the argv flag
constants; `budgetSettings` (`src/Agent.ts`) keys the inline settings on it
as a computed key, and `additionalContext` (`src/budgetHook.ts`) writes it as
`hookEventName`. Cross-module consumer, so the export pin is satisfied
without an `src/index.ts` line.

What a later sweep should not "finish": `tests/agentBudget.test.ts:84,88,90`
and `tests/budgetHook.test.ts:83,114` still spell `"PostToolUse"` by hand,
on both sides — the settings reader and the hook's echoed output. That is
deliberate, not residue. The constant holds the two production sites in
agreement with each other; only a hand-authored literal holds them in
agreement with the *provider*, which is the fact neither side owns. Folding
the tests onto `HOOK_EVENT_NAME` would compare the constant to itself and
leave a rename of the provider's event green in both places.

No test filed with this entry: the change is behavior-free, and the property
it would pin (the two sites agree) is now a typecheck fact rather than a
suite one — there is no second literal left to disagree.
