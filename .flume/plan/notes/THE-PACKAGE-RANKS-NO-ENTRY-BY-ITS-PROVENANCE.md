# The bands are out; `priority` is now a field nothing in the package states

Shipped as scoped. Three things the next tick should know.

**`priority` is unowned surface now.** The core schema still carries the field
and its default, and no package prose names it: the discipline page's rank
section and the slices' band clause are both gone. So a slice can write any
number and nothing reads it, and the queue's transient order is the default
plus tag. Fine until `Chain.order` lands, but it is a live window where a rank
a slice invents is accepted silently. If that window is not meant to stand,
the ordering entry wants a `blockedBy` on this one rather than the reverse.

**`GateEngine.parsePendingQueue` went with the gate.** It was the band gate's
only reader, so it would have been dead plumbing. `harness/chain.ts` no longer
wires it. `GateEngine` is exported, so this narrows a public type — pre-1.0
clean slate, but worth knowing if an ordering gate wants a queue parse back:
it comes back off `api.parsePendingQueue` in one line.

**`queueProducer` became `isQueueProducer`, a boolean.** It answered with the
slice only because the band gate was built from it; nothing else needs the
identity, and the two remaining uses are `!== undefined` checks.

**`docs/CHAIN-AUTHORING.md`'s gate roster is pinned one way only.** The case
`docs/CHAIN-AUTHORING.md names every gate the package's discipline set holds`
reads build's set against the page, so a gate the page names and the set has
dropped reds nothing — I removed the `filing band` row by hand. A converse arm
(the page names no gate the set lacks) is a real pin and cheap; filing it is
plan's call, not something I widened this entry to take.
