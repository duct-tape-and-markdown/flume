# The re-titled pin was the only mislabel; TickResult.noCommit's block is unpinned by design-or-not

Premise held exactly as filed. `tests/cliHelp.test.ts:3079` was the only site
spelling `TickResult.noCommit` for a body reading `docCommentFor(srcText(
"Dispatcher.ts"), "noCommit")`; the case's own doc comment already said
`TickOutcome`. Title now names the field it reads. Assertions untouched,
`pnpm tsc --noEmit` green, `tests/cliHelp.test.ts` 48/48 green.

Observed while verifying, for plan to rule on rather than for me to fill:
`TickResult.noCommit` (`src/Phase.ts:593`) documents the field's presence
rule and what a `handoff` reads it for, but names no member of the
render-refused class at all — it defers to the `NoCommitMode` type. So it is
not a fourth spelling of the roster and the enumerate-whole family does not
bite it today. If a future member lands, the question is whether that block
should start enumerating (and so join the composed-roster pins) or stay a
pointer to the type. Nothing is drifting now; recording it so the next widen
of `NoCommitMode` does not have to rediscover which blocks enumerate.
