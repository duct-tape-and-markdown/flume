# The ledger commit's new refusals reach a catch that drops the verdict

`commitPaths` (`src/git.ts`) now runs `git commit --only -- <paths>`, which
refuses two new ways: named paths with no change, and a partial commit while
the operator has a merge or cherry-pick paused on the primary checkout.

Both surface at `commitPendingUpdate`'s call site in `runFanout`
(`src/waveTick.ts`, ~line 817). That catch folds the wave's TickVerdict onto
the error for `PendingParseFailure` alone; anything else re-throws bare, and
the verdict — already-shipped tags, gate results, merge footprints — is lost
with it, even though those tags are real on trunk. Not new (a disk error or an
`index.lock` always took that arm), but the refusals this entry adds are
reachable from ordinary operator state, so the hole is now easy to hit.

Two shapes for plan to choose between: a typed refusal from `commitPaths`
(the `ResetKeepRefusedError` precedent in the same module) that the catch
folds like `PendingParseFailure`, or widening the catch to carry the verdict
on any throw and let the cause stay unclassified. The first keeps the engine
reporting a fact rather than a stack trace.
