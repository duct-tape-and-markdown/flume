# The revert leg still holds the span footprint mutable, and its widening is a second surface

The gate-facing half shipped: `GateContext.touchedPaths` and
`runAfterCommitGates`'s `spanTouchedPaths` parameter are `readonly string[]`,
so no gate can edit the one array into what the next reads. `src/` needed no
other widening — every reader in `src/` and `harness/` was already read-only in
practice, and `harness/judge.ts`'s `footprint` was already declared readonly.
Four capture variables in `tests/Dispatcher.test.ts` and the one in-place sort
at `tests/builtinGates.test.ts:741` were the whole red.

Observed and deliberately left: `revertAfterCommitFailure`
(`src/tickAttempt.ts`) takes that same instance as mutable `string[]` and
returns it as `footprint`. Probed the widening — it reds at
`AttemptFacts.footprint`, whose consumers are `src/singletonTick.ts`,
`src/waveMerge.ts` and `src/pendingLedger.ts`'s `m.footprint`. That is the
*persisted footprint record* surface, not the gate-facing span, and it carries
its own claim, so widening it here would have been a second promotion riding a
commit that names one. The revert leg also runs after the gate loop, so a
mutation there cannot reach a gate — the entry's claim is fully held without
it. If the record surface is worth the same rung, it is its own entry.

Also worth plan knowing: the *identity* half of the sharing was already pinned
— `tests/Dispatcher.test.ts` asserts `secondTouched` is the same instance as
`firstTouched` for a singleton tick. Only the *mutability* half was prose. The
two halves now sit at adjacent rungs (pin and type) for one fact, which is why
the shrunk doc comment points at the type rather than restating either.
