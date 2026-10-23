# The corpus still names the abort and the warm trunk

Five sentences in the human-held corpus describe the shape the merge-candidate
rework retired. Phases cannot touch `spec/`, so they need a directed pass.
Sources: the build notes TRUNK-MOVES-ONLY-BY-FAST-FORWARD-TO-A-JUDGED-CANDIDATE
and A-BATCHS-SPANS-REACH-ONE-CANDIDATE, drained this tick — both written after
the last corpus pass (`caac1937`), which is why that pass did not reach them.

## `cherry-pick --abort` no longer runs anywhere

Verified this tick: no abort call in `src/`. A stopped pick leaves with the
candidate, and removing that worktree takes the tree, the index and git's
sequencer state together. `spec/loop.md`, *Crash equals stop* already states
the target ("hosts no cherry-pick, abort, or reset"), so these three read as
the stale half, not as the target:

- `spec/loop.md`, *The engine records, never navigates* — "with `cherry-pick
  --abort` on conflict" (line 129).
- `spec/loop.md`, *Tip verify — one writer per branch, absorption at the
  merge* — "a conflicting cherry-pick aborts (`cherry-pick --abort`)" (line
  449).
- `spec/pending.md`, *`observedFiles` — the dispatcher's collision record* —
  the footprint "captured before the cherry-pick is aborted" (line 370).

Plain edits, unless you read the abort as the target and the tree as wrong.

## The `afterMerge` gate no longer runs on the trunk

Every merge cuts a candidate and the gates judge it — which
`spec/worktrees.md`, *Per-entry `afterMerge` revert isolation* already says.
Two sentences still say otherwise:

- `spec/worktrees.md`, *The default test lane must stay fast* — the gate "runs
  on the **trunk**, not inside a worktree" (line 453).
- `spec/chain.md`, *Gate placement is the chain's decision* — "that gate runs
  on the warm trunk" (line 487).

**This is the half that wants a decision, not an edit.** The cost argument
moved with the shape: every merge now provisions a candidate and pays the
chain's install, so "the trunk is already warm" is no longer why expensive
correctness gates at `afterMerge` are cheap guidance. Either the two pages
state the new price — one candidate install per merge, bought for the
no-rewind guarantee — or the guidance itself is worth re-deciding.

## One gap, not drift

The candidate runs `setupWorktree`/`teardownWorktree` (shipped: an
`afterMerge` gate resolving a tool out of `node_modules` has none otherwise),
and a setup hook that throws walls the wave. `Phase.setupWorktree` and
`docs/CHAIN-AUTHORING.md` name that third tree; `spec/worktrees.md`,
*`setupWorktree` and `teardownWorktree` — the chain's provisioning hooks* says
nothing about it.
