# The roster shape has a fifth site, inside STATE_ROOT_NAMES' own header

All four warrants now state what the program holds. The two `the one
consumer` claims took the `escapesRoot` shape rather than a fuller roster:
the counts had already moved past the entry's own tally. Measured this tick,
`STATE_ROOT_NAMES` has seven bare-name consumers, not three —
`src/runtimeIgnores.ts`, `harness/ignores.ts`, `src/cliHistory.ts:59`,
`src/cliStatus.ts:259`, `src/cliTick.ts:182`, `src/cliStateDirs.ts:144`,
`src/tickAttempt.ts:872` — which is the argument against naming them: a
roster drifts between the sweep that writes it and the one that reads it.
Three consumers for `STATE_ROOT_DIRNAME`, as the entry said.

Observed, unfiled: the same family has a fifth site one paragraph above the
one I repaired. `STATE_ROOT_NAMES`' header opens by listing the names the
object holds — "the baton dir, the prior-attempt records, the merge-stage
markers, the one-supervisor lock, the stop flag, the tick verdicts" — a
hand-kept roster sitting on top of the literal it restates, and already
stale: it omits `renderedPrompts` and `worktrees`, two of the nine keys.
Left alone as a sentence the entry did not name, but it is the same defect
as the warrant beneath it and it is wrong today, not just at risk.

`liveLoopPid` has no `src/` or `harness/` caller at all; its only consumers
are `tests/pidClaim.test.ts` and the loop-lock agreement case in
`tests/cli.test.ts`, where a chain's agent reads the lock back mid-run. The
warrant now names those. Worth a plan read on whether that export's place is
the suite's or the package's: it is not in `src/index.ts`, so a chain
reaching for it reaches a deep path, as that fixture does.

The `resolveHandoff` sentence lost the refusal `defaultHandoff` threw before
dec69e0e (a slice set with no inbox phase in it) and now states what the
default actually holds: nothing a declaration must satisfy.
