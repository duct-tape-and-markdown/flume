# The queue has one home and two alphabets

`harness/layout.ts` now states every plan artifact's path and the fence that
is their list. Two things for the next tick.

1. A win32 behavior fix rode the refactor. `gates.ts` built the queue's
at-ref path with `join(stateRootRel, relative(flumeDir, pendingPath))`; it
now goes through `underStateRoot`, which folds the host tail. On posix both
spellings are identical, so no case here can fail on the pre-fix tree — the
entry named no `tests[]` and I did not manufacture one. It is pinned as a
property of `underStateRoot` alone.

2. The queue is spelled once but reached in two forms: `queuePath` (git's
alphabet — the fence, init's written line, the at-ref read) and the engine's
`resolvePendingPath` straight (host-native — fs calls, `PENDING_PATH` in the
prompts). Folding the prompt arg would change what an agent is told to open
on win32, so I left it. If that split later reads as two homes, the fix is a
named second accessor in layout.ts, not a fold at the prompt.
