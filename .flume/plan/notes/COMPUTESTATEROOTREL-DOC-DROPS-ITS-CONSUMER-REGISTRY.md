# computeStateRootRel's second parameter is named for one caller

The trim shipped as filed: the registry paragraph is gone, the fold-at-one-
reporter rule stays, and `Dispatcher.stateRootRel` (`src/Dispatcher.ts`) took
the once-at-construction fact no other site held. The friction
(`src/friction.ts`), gate-context (`src/Gate.ts`, `src/tickAttempt.ts`) and
ledger (`src/pendingLedger.ts`) legs each already stated why they ask, so none
needed an edit.

What the trim exposed: `computeStateRootRel(repoRoot, flumeDir)` names its
second parameter after one of its callers. Two of the three call sites pass a
state root; the third (`attemptCtx`, `src/Dispatcher.ts`) passes `configDir`.
While the doc carried the registry, the paragraph naming that caller was doing
the work of explaining why the parameter's name does not match what is passed.
Without it the doc says the generality in prose ("the second root is the
caller's to choose"), which is the rung-below spelling of a fact a parameter
name could hold (`.claude/rules/engineering.md`, *Narration is the ladder's
bottom rung*).

A rename to something neutral is mechanical and engine-internal: the export's
shape does not change, only the `.d.ts` hover text, and that prose paragraph
would shrink to nothing. Out of this entry's scope, so I left it. The
function's own name carries the same bias, and renaming the export is a wider
call than renaming a parameter.
