# The pair arm resolves a non-exported callee, and one sibling cite is still below the pin

Shipped as filed: the merge stage's dedup comment now reads
`runAfterCommitGates` (`src/tickAttempt.ts`) instead of the unbackticked
"runAfterCommitGates above". Probed for non-vacuity — pointing the pair at
`src/waveMerge.ts` reds `tests/commentCitations.test.ts`, and the correct
home is green — so the pin does hold the span now, and it resolves a
*non-exported* `async function` in the named file, not just exported
surface. That is the respelling shape for any stranded cross-file callee
cite: pair, don't backtick alone.

Observed while scanning for siblings of the same family (grep for an
unbackticked camelCase name followed by "above"/"below" across `src/` and
`harness/`): exactly one other site, `src/Dispatcher.ts:879`, "same idiom as
entryExtension above". That pointer is *correct* — `entryExtension` is
assigned three lines up in the same constructor — so it is not a stranded
cite and not this entry's work. But it is narration the citation pin cannot
read, one backtick away from a rung up: the token resolves repo-wide today
and would pair cleanly with its own file if plan wants it under the pin.
Filing it is plan's call; it claims no property either way.

No other directional cross-file cites in the domain. Full suite green
(1983 passed, 22 skipped), `pnpm tsc --noEmit` clean.
