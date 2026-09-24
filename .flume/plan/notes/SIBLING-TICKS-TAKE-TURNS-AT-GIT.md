# The merge stage is now a 500-line try block in waveTick.ts

Shipped. Three deviations from the entry's predicted files, and one shape
finding.

**Where the primitive landed.** Not `src/pidClaim.ts` — that module's header
disclaims acquisition ("what to do about a claim belongs to the guard that
read it"), so a wait-and-reclaim acquire there would be the second job the
header denies. New module `src/waitLock.ts`, with the two common-dir paths
and `acquireShipLock` composed in `src/git.ts` beside `acquireTipClaim`
(waitLock cannot import git.ts — git.ts needs the worktree lock, and the
cycle would name itself). `src/pidClaim.ts` did gain `livePidClaimAt`, the
"parse it then signal-0 its pid" read that `liveLoopClaim` and
`liveTipClaimPid` each spelled separately; both now delegate, so the wait
lock is not a third copy.

**Where the worktree lock landed.** Inside `src/git.ts`, wrapping
`addWorktree` / `removeWorktree` / `pruneWorktrees` themselves, not the eight
call sites in `worktrees.ts` / `waveTick.ts` / `singletonTick.ts`. A per-site
wrap is a list a new call site drops off. Cost: an optional `log` on those
three, threaded from every caller that holds one.

**The finding.** `runFanout`'s merge stage is now one `try` from the
cherry-pick loop to `clearMergingMarkers` — about 500 lines whose only
marker is an indent level. It reads as its own job (`engineering.md`, *A
module is one job*): a wave's merge/gate/revert/ledger stage, taking
`perEntry` and answering with the merge outcomes and gate rows the verdict
needs. Splitting it out of `waveTick.ts` would make the lock's span a
function signature rather than a brace pair. Behavior-free, held by tsc and
the suite — an entry, not a debt line, if plan agrees.

**Deliberate.** The wait is unbounded: the spec states no deadline, a holder
is a sibling of this run bounded by its own tick timeout, and its death is
what the liveness probe reads. The poll interval is engine-internal with no
chain knob — no verb takes or drops either lock, so a chain has nothing to
key a policy off.
