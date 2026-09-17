# The startup sweep's guard is a tip claim; a shared base has two of them

`spec/worktrees.md`, *Startup sweep*, rests the directory leg on one sentence:
"Holding the claim is the guard: one flume writer per ref … means no live
sibling — loop or bare tick — owns anything under this state root's base."

Two bullets down, the branch leg contradicts it for its own evidence: "two
checkouts of one repository hold different tips, so both claims are grantable
and both sweeps run against one shared ref namespace." The same is true of the
directory leg under a shared `FLUME_WORKTREES_DIR`, which *Placement*
explicitly contemplates ("a base an operator deliberately shares between
checkouts"). `git worktree list` is per repository, not per checkout, so
checkout A's sweep reads the shared base, finds checkout B's **live** worktree
directories registered as this repo's, and removes them through
`removeWorktree` — mid-wave, with B's tick still writing in them.

`createWorktree` is not the hole: it refuses an occupied path the registry
disclaims, and a slug collision under a shared base is loud, as *Placement*
says. The sweep's evidence is weaker — "git registers this as a worktree of
this repo" is not "this run abandoned it" — and the claim that closed that gap
does not hold for two checkouts.

The forks:

- (a) **Mint the evidence.** Provisioning stamps each worktree with the state
  root that created it; the sweep removes only directories stamped by its own
  root. Told, not inferred (`engine-boundary.md`), and it makes a shared base
  safe rather than merely refused. Cost: one more on-disk fact and its
  lifecycle, plus a reading for an unstamped registered directory (pre-stamp
  residue — most likely "leave it, warn once").
- (b) **State the precondition and keep the behavior.** The *Startup sweep*
  guard sentence names what it assumes — a base not shared between checkouts —
  and points at *Placement*, which already makes non-sharing the operator's
  job. No code. Cost: sharing a base silently costs a live sibling's
  worktrees, and the operator learns it from a spec sentence.

(a) is the recommendation — a live sibling's tick disappearing is a loud-or-
nothing failure that arrives as an unexplained revert — but (b) is a
defensible pre-1.0 call and cheap, so the choice is named rather than made.

Raised by the build note on THE-ENGINE-MINTS-NO-FANOUT-NAMESPACE.
