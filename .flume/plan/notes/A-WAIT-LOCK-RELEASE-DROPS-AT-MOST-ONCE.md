# Two guard-handle interfaces now spell one shape

The drop is shared: `atMostOnceDrop` (`src/pidClaim.ts`) is what both
`stakePidClaim` and `acquireWaitLock` (`src/waitLock.ts`) return as their
release, so the wait lock's doc claim to "the same shape the tip claim's
release carries" is now the same function rather than a second spelling.

Observed while doing it, not filed: `WaitLock` (`src/waitLock.ts`) and
`StakedPidClaim` (`src/pidClaim.ts`) are now structurally identical — a
readonly `path` and a `release: () => void`, both meaning "the guard file
this process created, and the one way to give it up". That is one vocabulary
spelled by two siblings (`.claude/rules/engineering.md`, *A module is one
job*). Folding them would put the handle type in `pidClaim.ts` beside the
drop that makes it true and leave `waitLock.ts` holding only the loop the two
guards differ in. I left it: the entry named the drop, not the type, and the
fold touches `src/git.ts`'s two composed locks and `src/entryClaims.ts`'s
reading of the stake, so it is a wave of its own rather than a rider here.

No caller double-releases a wait lock today, so nothing observable changed —
this closed the latent half of the stake's guard.
