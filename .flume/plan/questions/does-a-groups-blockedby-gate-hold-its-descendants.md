# Does a `group`'s `blockedBy` hold its descendants anywhere but the spec sentence?

`spec/pending.md`, *The entry core* states it outright: "`parent` is containment
only; precedence is `gate`, and a `blockedBy` on a `group` or `work` entry holds
every descendant." The engine does not do it. `isPickableNow`
(`src/PendingSchema.ts`) switches on `entry.gate` alone; `isPickable`
(`src/selection.ts`) hands it this queue's tag membership and that module never
reads `parent` at all; no test in `tests/` pins an inherited gate. So a plan tick
that follows the discipline page's instruction — "a dependency the whole goal
waits on is declared once, at the goal"
(`harness/prompts/plan-discipline.md`) — gets every descendant picked on the next
wave: the wrong order no gate can see, in the one spelling the page recommends.

The two spec sections also disagree with each other. *Pickability* states the
exported signature as `isPickableNow(entry, shippedTags, isForkResolved?,
capabilities?)` and calls the two implementations "one rule set" — neither
implementation is handed an ancestor chain, so the sentence above cannot be
honored without one of the two sections moving. That is the fork, and it is not
plan's to pick.

- **Fold at selection.** Selection composes an effective gate over the ancestor
  chain before the per-entry switch; `isPickableNow` keeps its signature and
  inherits nothing. *The entry core*'s sentence then names the queue read rather
  than the exported predicate, and *Pickability*'s "one rule set" loses its
  second half: tooling and selection answer differently for a descendant of a
  blocked group.
- **Widen the predicate.** `isPickableNow` takes the ancestor chain (or the
  listing) and one rule set holds. *Pickability*'s stated signature changes, and
  every consumer moves with it (`src/flumeApi.ts`, `src/index.ts`,
  `examples/backlog-groomer-chain.ts`).
- **Drop the sentence.** Inheritance leaves *The entry core*, plan declares a
  goal-wide dependency on each `work` entry beneath the goal, and the discipline
  page's "declared once, at the goal" goes with it. Cheapest, and it is what the
  engine does today.

Which shapes a containment deadlock covers rides on this answer:
`A-BLOCKEDBY-ACROSS-ITS-OWN-CONTAINMENT-IS-REFUSED` refuses only the arms dead
under all three readings (a `work` entry waiting on its own ancestor or its own
step). A `group` waiting on its descendant is dead under the first two readings
and inert under the third.
