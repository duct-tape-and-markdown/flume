# A span the trunk already holds: what does the tick report, and does a partial span land?

From the field (0.19.0, three times in one day). A tick's span, cherry-picked
onto a tip that already carries the same change, stops on git's "previous
cherry-pick is now empty"; the pick throws, both callers
(`src/singletonTick.ts:378`, `src/waveMerge.ts:618`) read any throw as a
conflict, the tick counts errored, and enough of them trip the hibernate.

Verified this tick: `cherryPickRange` (`src/git.ts:294`) is a bare
`cherry-pick base..head` with no empty arm. `spec/loop.md`, *The no-commit
taxonomy* rules only the span empty against its **own base** (`clean-exit`,
never reaching the merge stage), and its parenthetical records this case as
current behavior rather than ruling it. `spec/loop.md`, *Tip verify* rules a
**conflicting** pick into `MergeFailure`; an empty pick is not a conflict.

Three forks, and the engine cannot pick any of them:

1. **What the tick reports.** The reporter wants no-commit, not errored. No
   `NoCommitMode` member and no merge outcome names "the trunk already has it".
   Options: (a) a fifth mode — a spec clause, and it reaches the exhaustive
   handoff refusal table (`harness/standingRefusal.ts`); (b) a new merge
   outcome, the tick staying committed-or-not on its siblings; (c) `clean-exit`,
   widening that row to cover empty-against-tip. I lean (b) — the fate is per
   span, which is where the verdict already reports picks — but the class the
   handoff refuses on is yours.
2. **Partial redundancy.** A multi-commit span where only some commits are
   already on the trunk: drop those and land the rest, or refuse the span?
   Dropping ships a tree no worktree ever gated.
3. **Detection.** Keying on git's English stderr is the `engine-boundary.md`
   defect. Durable evidence exists on both sides of the throw: pre-check the
   span's patch-ids against the trunk, or after the throw read that
   `CHERRY_PICK_HEAD` stands with the index equal to `HEAD`. `--empty=drop` is
   git 2.45 and the engine's floor is 2.36 (`spec/chain.md`), so it cannot be
   the mechanism. Which evidence is right follows from (2).

Worth ruling alongside: *why* two ticks drained the same records. If the 0.20
tip-read wake closes sibling double-drains, this is rarer but still reachable
by an operator commit landing the same change.

Nothing files until 1 and 2 are ruled — the detection shape follows from them.
Repro to reduce: a singleton span whose one commit's diff is already on the
trunk tip, one merge.
