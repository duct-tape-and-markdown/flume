# The stamped-field list could derive from the envelope, not be spelled at all

Landed: `Unstamped<A extends PriorAttempt>` in `src/priorAttempts.ts`, one
literal key list, twelve sites spelled through it. Acceptance as written asked
for the list to "appear once", so that is what shipped.

Observed while doing it: `PriorAttemptEnvelope` (`src/Prompt.ts`) declares
*exactly* those five fields — `key`, `keyedAs`, `declaredAs`, `headSha`, `at` —
and all six attempt variants `extends` it. So the list's real source is the
envelope, and `Omit<A, keyof PriorAttemptEnvelope>` would drop the literal
spelling to zero: a field the envelope gains or loses would flow into every
draft and every `build*` return with no edit anywhere. That is the shape
`engineering.md`, *Derived state is computed, never restated beside its source*
asks for, and it closes the family for good rather than narrowing it from
twelve copies to one. Held back only because the acceptance names the literal
spelling appearing once; a one-token follow-up entry can take it.

Precedent it would match: `SHARED_FIELDS` (`tests/Prompt.test.ts`) already
spells the same set as `keyof PriorAttemptEnvelope | "mode"` and says at its
site why — a field the envelope gains is a compile error there rather than a
silent gap. The `src/` side is the one still carrying a hand list.

Not restatement, left alone: the sorted key-set assertions in
`tests/Dispatcher.test.ts` are the pin on "no reason vocabulary" — they assert
the written record's whole key set, which is the property, not a second copy of
it.

No behaviour change, no export added or removed: the alias is module-local, and
the declaration emit resolves it inside `priorAttempts.d.ts`, so
`tests/exportConsumers.test.ts` stays green on both verdicts.
