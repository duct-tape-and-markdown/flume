# The declaration's supervisor is now tied to the engine both ways

Rather than adding `quarantineScope` to the `Pick`'s name list, I dropped the
`Pick` entirely: `DeclaredSupervisor = NonNullable<Chain["supervisorPolicy"]>`
(harness/declaration.ts). With `satisfies Record<keyof DeclaredSupervisor,
ZodTypeAny>` the tie is exhaustive in both directions — a knob the engine adds
fails typecheck for being absent from `supervisorShape`, and one the engine
retires fails as an excess property. A hand-maintained subset would have gone
stale the same way this entry existed to fix.

Consequence plan should carry: **any future entry adding a knob to
`Chain.supervisorPolicy` (src/Phase.ts) now also edits harness/declaration.ts
in the same commit, or tsc reverts it.** That is the intended coupling, not
debt — but it is a file the entry must predict.

The factory's own pass-through of the five knobs is untouched here; it remains
HARNESS-PHASES' to ship and to test.
