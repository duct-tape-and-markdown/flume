# `spec/worktrees.md`, *Placement — the worktree base*: the occupied-path
# refusals are now three, and the section states two

**Ask:** reconcile the section's prose with the mechanism that now produces
the outcome it promises. `spec/` is yours; plan cannot edit it.

## What the section says

> `createWorktree` clears the computed `<base>/<dirName>` path only when
> git's own worktree registry names it as a worktree of this repo […] An
> occupant the registry does not name, or a registry that cannot be read,
> refuses the tick naming the path and provisions nothing.

and, in the last paragraph:

> Under a `FLUME_WORKTREES_DIR` the operator deliberately shares between
> checkouts they collide, and the registry check above refuses the tick
> naming the path rather than removing the occupant.

## Why it does not hold

The registry never refused the shared-base collision — it names every
worktree of the *repository*, a live sibling checkout's tree included, so a
colliding directory name passed the registry check and the occupant was
removed. The second paragraph described an outcome its stated mechanism
could not produce.

`createWorktree` now makes a third judgment after the registry one
(`src/worktrees.ts`, shipped at `4ea5039d`): a registered path this state
root did not stamp — a sibling's tree, or pre-stamp residue — refuses the
tick and is left standing. That is what makes the last paragraph true, and
it is the same evidence `sweepStaleWorktrees` already reads.

## Proposed edit — one clause and one attribution

1. In the exclusivity paragraph, add the third refusal beside the two:
   *"…or a registered worktree this state root did not stamp"*. Worth
   naming the trade the note records: residue predating the stamp, and
   residue from a provisioning that died between the `worktree add` and the
   stamp, now need a hand — the same trade the startup sweep took when it
   began reading the stamp.
2. In the last paragraph, `"the registry check above"` becomes the stamp
   check, since that is the one that refuses this case.

Straight reconciliation, no fork — filed as a question only because the
artifact is yours. If you would rather the section name one combined
"provisioning judgment" than enumerate three refusals, say so and the
wording follows.

The consumer-facing twin of this — `docs/MIGRATING-0.17.md`'s shared-base
paragraph — has shipped: it now attributes the refusal to the stamp and names
the hand-clearance that arm costs. So the note and this section disagree until
this one is edited.
