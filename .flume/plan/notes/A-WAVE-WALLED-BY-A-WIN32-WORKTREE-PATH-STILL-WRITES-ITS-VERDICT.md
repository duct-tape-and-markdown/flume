# The walled-wave arming is injected now; why the wreck stops denying on win32 is still unread

Both armings (`waveHoldingBothWalls`, `waveTornDownByASlotLeg`,
tests/Dispatcher.test.ts) now share `refuseBoomBTipRead`: a `git.revParse`
spy scoped to BOOM-B's worktree and armed by its agent's return, so the
slot-leg wall is raised identically on every host. Each of the five cases
pins `tipDenials > 0` — the arming's own count — instead of reading
`<worktree>/.git` off disk, which was the read that ENOENTed on win32 once
the un-armed slot's tail removed the directory.

Two things for a human, neither fileable from here:

1. **Unmeasured platform fact.** A `.git` gitfile pointed at a missing
   gitdir denies on posix and (per the windows lane's reds) denied nothing
   there. The mechanism is unread — git's discovery should fatal on both —
   so this is not yet a `platform-facts.md` entry. It matters beyond this
   file: *`chmod` denies nothing on win32* tells a case to "deny
   structurally wherever the code path allows it", and this is a structural
   denial that silently un-armed. If the lane can be read once, the fact is
   worth the page; if not, the guidance is one class weaker than it reads.

2. **Shape, not verified as a family.** The defect class is a vacuity pin
   read off a fixture's own planted file under a path the tick may have
   torn down — green where the arming armed, ENOENT where it did not, and
   never "the wall did not happen". An arming that answers its own denial
   count cannot lie either way. I did not sweep for siblings of this shape;
   if it recurs, it reads like a standing-lens candidate rather than a
   per-case entry.

No engine change: the reported surfaces (`unclassedWalls`, `summary`,
`mergeOutcomes`) were never wrong — only the fixture that was supposed to
make them speak.
