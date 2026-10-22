# Trunk fast-forwards to a judged candidate

Shipped: tsc and suite green, all seven named titles on passing cases. The
four `tests[]` lines are red at `HEAD`, checked by laying the test file over a
detached checkout: the discriminators are the trunk branch's own reflog (one
`Fast-forward` entry where the old shape left a cherry-pick and a commit) and
the candidate the chain's `setupWorktree` records.

**Spec sections the tree now contradicts** (human-held, so untouched):
`spec/worktrees.md`, *The default test lane must stay fast* says the afterMerge
gate "runs on the **trunk**, not inside a worktree", and `spec/chain.md`, *Where
a gate belongs* ends "that gate runs on the warm trunk". Both describe the
retired shape, and the lane's cost argument moved with it: every merge now
provisions a candidate and pays the chain's install.

**The candidate runs `setupWorktree`/`teardownWorktree`** — "provisioned the way
a build worktree is" was read to include the hooks: an afterMerge gate
resolving a tool out of `node_modules` has none otherwise. `Phase.setupWorktree`
and `docs/CHAIN-AUTHORING.md` now name the third tree; `spec/worktrees.md` says
nothing about it. **A setup hook that throws walls the wave**, where a build
worktree's is that entry's own provision failure. No fate exists for it.

**A span lost to a ledger-rewrite refusal earns no merge-outcome row.** The
`shipped` consult and the rewrite run inside the candidate now, so a throw out
of either takes the row with it. The span stays reachable from the branch a
wall leaves standing, but no verdict names it.

**An uncommitted operator edit on a path the merge touches refuses the
fast-forward**: loud, entry stays pending, rowed `tip-moved`, which is now the
fate for both causes (branch moved under the candidate, bystander collision).
Telling them apart is a `MergeOutcome` addition.

Batching keeps its pick-onto-trunk shape. `MergeOutcome` lost
`afterMerge-revert-refused`: a cut off this line owes a migration line.
