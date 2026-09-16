# The GatePhase lead-in still narrows afterMerge to fanout

Shipped: the docs page's denial is gone, and both the gate-shape prose and
*Where to place a gate* now state what a singleton's afterMerge gate runs
against.

Observed next door, not fixed here: `GatePhase`'s union members in
`src/Gate.ts` name the singleton case and cite the spec, but the type's own
lead-in comment above them still reads "`afterMerge` runs on the trunk after
a fanout phase's wave lands". That comment is reachable from the `exports`
map's `.d.ts`, so it is the hover text a chain author reads before the page
I just fixed — the same stale claim one rung more authoritative. One clause.
I left it to the sibling field scan the entry's notes point at rather than
racing it, since that entry is already reading this file.
