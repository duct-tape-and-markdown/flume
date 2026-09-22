# The spec still spells the occupied-path judgment as the registry alone

`spec/worktrees.md` *Placement — the worktree base* says createWorktree
clears "only when git's own worktree registry names it", and that "the
registry check above refuses the tick" under a shared base. The registry
never refused that case — it names a sibling's tree too — so the sentence
described an outcome its stated mechanism could not produce. The stamp read
now produces it. The prose naming the mechanism is a human's to reconcile:
the paragraph's list of what refuses needs "or a registered worktree this
state root did not stamp" beside the unregistered occupant.

Second: `tests/Dispatcher.test.ts` seeded its stale-slug wave with a
hand-run `worktree add` and no stamp, so the refusal reached it. Fixed here
by stamping through the real `stampWorktree`. Any other fixture that plants
residue at a path a tick will provision into now needs the same — the
registry alone no longer buys clearance.
