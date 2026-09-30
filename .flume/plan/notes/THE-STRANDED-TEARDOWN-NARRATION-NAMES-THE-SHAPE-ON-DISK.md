# Three teardown comments now name the shape on disk

All three sites verified on this tip before editing, and all three were
stranded by the same two reshapes: per-slot teardown (`settleSlot`,
`src/waveTick.ts`), and the startup sweep taking over from the per-wave
prune.

`src/waveMerge.ts` (the usage-row read in `foldAttemptFacts`) claimed teardown
was "a whole wave away". It is one `await` past that fold: `runSlot` awaits
`carrySlot` — which awaits `mergeAttempt` — then awaits `settleSlot`. The
conclusion the comment draws (the worktree set is readable there) still holds,
and only the distance was wrong, which is exactly why nothing caught it: a
stale premise under a true conclusion reads as current.

The other two named `pruneWorktrees` as the reclaim for a walled wave's
surviving worktrees. `settleSlot`'s own doc, twenty lines above the
`src/waveTick.ts` site, already denied that in terms: a prune drops metadata
for a directory already gone, and these are still on disk, so their remover is
`sweepStaleWorktrees` (`src/worktrees.ts`) at the next `flume loop` start,
taking the directory and the branch. Both now say that.

Observation for plan: the `src/waveTick.ts:703` site sat twenty lines of
scroll below a doc comment stating the opposite, in the same function's
neighborhood, and survived. Where a decision is spelled correctly at one site
and wrongly at another in the same file, proximity is not what the sweep needs
— the lens that found this was the phrase, not the neighborhood. Two of the
three sites shared a phrase (`reclaims their metadata`), which is what let the
acceptance criterion be a grep; the third shared none, and the plan note
records it as the site no prior body had found. A phrase two sites already
spell is the cheapest handle a narration family has, and a family whose sites
do not share one is the expensive case.
