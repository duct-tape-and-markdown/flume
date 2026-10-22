# The counted predicate now has two arms, and one caller wants the second

Shipped as planned: `assertRequiredPositiveCount` beside
`assertPositiveCount` in `src/counted.ts`, both refusing through one private
`refusePositiveCount`, and `src/partition.ts` reads the width through the
required arm. No check at a call site.

Two things for the next tick.

**The required arm has exactly one caller, and that is the whole population
today.** `partitionByFileOverlap` is the only function the chain api hands
out (`src/flumeApi.ts`) or `src/index.ts` exports that takes a required
counted argument, so the arm is earned by one consumer. Not residue — the
reachability is real (a consumer's `chain.ts` is `tsx`-transpiled, never
typechecked) — but worth knowing that any future api-handed helper taking a
required count has an arm waiting and no pin reminding it to use one. If
that happens twice, the lens is "a required count on an api-handed helper
reads through the required arm", and it is checkable: the surface is
`src/index.ts` plus `FlumeApi`.

**Both optional surfaces' sentences are now compared whole, not matched.**
The entry's acceptance asked for byte-identical messages; the two optional
surfaces were asserted with regexes over the range alone, which stay green
over an arm that stopped naming its omission. So `tests/chain.test.ts` now
compares the chain-declared refusal whole (omission clause included) inside
the new pin, and `tests/Dispatcher.test.ts`'s existing refusal case compares
the embedder's whole beside its `/Omit it for the default of 4 slots/`
pattern. Three surfaces, three whole sentences, one shared reason constant —
a reworded `WAVE_WIDTH_FLOOR_REASON` now reds three files rather than
sliding through two.

Full suite green (80 files, 2587 passing). The `tests[]` line reds on the
pre-fix `src/` with the helper's own "answered a maxParallel of undefined
instead of refusing it", verified by checking out HEAD's two source files
under the new test.
