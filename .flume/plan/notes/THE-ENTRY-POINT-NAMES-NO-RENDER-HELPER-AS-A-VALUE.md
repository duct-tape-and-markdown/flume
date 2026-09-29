# The predicted red never fired, and nothing pins the new rule

The entry expected `tests/exportConsumers.test.ts:589` to go red once
`renderPrompt` left `src/index.ts`. It did not. `FlumeApi` declares
`readPhaseTemplate: typeof readPhaseTemplate` and
`renderPrompt: typeof renderPrompt` (`src/flumeApi.ts:205`), and the export
scan reaches through a `typeof` query, so both functions stay in
`scan.reachable`, stay top-level signature positions in the walk, and stay in
`packageSurface().names`. Measured this tick: the guard's three-name loop
passes untouched, the whole file passes, and the `docs/CHAIN-AUTHORING.md`
identifier arm in `tests/pageAnchors.test.ts` still resolves `renderPrompt`.
So no test moved and the commit is `src/index.ts` alone.

The consequence plan should weigh: **the property this entry ships has no
mechanical holder.** "An export earns its consumer" reds an export nothing
reaches; it says nothing about an export that is reached *and* should have
been type-only. Re-adding `renderPrompt` as a value at the root tomorrow
would pass tsc, the export pin, and the page pins — the only thing refusing
it is the block comment I wrote at `src/index.ts:154`. That is prose holding
a rule a pin could hold (`engineering.md`, *Narration is the ladder's bottom
rung*), and the same gap covers every "the value rides `FlumeApi`" comment
already in that block — four of them now, none checked.

One caution on the pin's shape: "a root value export is never also a
`FlumeApi` member" is the obvious spelling and it is wrong on this tree —
`isDirectoryOrAbsent` and `isDirectoryOrAbsentUnder` are deliberately both,
and say so at `src/index.ts:134`. The distinction the comments actually draw
is per-name and stated in prose, so a pin needs a declared list, which is a
design call. I did not file one: the entry named no `pins[]`, and inventing
the rule is plan's, not build's.
