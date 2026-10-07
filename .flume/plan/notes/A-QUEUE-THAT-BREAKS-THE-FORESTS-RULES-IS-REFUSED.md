# The forest refuses at the queue read; the prompt still does not state it

Shipped: the queue-wide forest check in `parsePendingQueue` /
`parsePendingQueueLoose`, `Chain.maxEntryDepth` (default 4, refused at load
below 1), threaded to every parse — dispatcher, `flume check`, `flume
status`, `pendingGate` (new `maxEntryDepth` option).

Two readings the section left open, both taken deliberately:

1. **An absent parent is a root, for every kind.** The pairings bound a
   declared parent only. Enforcing "a work entry's parent is a group"
   literally would refuse every entry in this repo's own queue, which is all
   root work entries, so the strict reading is unshippable without plan first
   grouping the queue. A root `step` is therefore also admitted — a step with
   no work entry is nonsense, but refusing it is a rule the section does not
   state. If plan wants either refused, it is a one-line change plus a test.
2. **A step's `blockedBy` tag must resolve in the queue.** "Names only steps
   of the same work entry" cannot hold for a tag naming nothing, and a step's
   blockers order one session rather than gating a ship. Consequence to watch
   when steps start shipping: if a step's file leaves the queue as its session
   finishes it, a sibling's `blockedBy` goes dangling and the next read
   refuses the whole queue. The ledger rewrite retires a wave's tags at once
   today, so nothing hits this yet.

**Gap, not filled:** the rendered plan schema states no forest rule. A
producer is told "one parent, so the queue is a forest" and then judged by
five rules it never saw — the pairings, the cap, the blockedBy scope. The cap
is chain-declared, so `renderSchemaForPrompt` would have to take it to say it
truthfully. That is prompt/parser seam work and it belongs with whichever
slice teaches plan to author forests, not here.

Also: `harness/` passes no cap to `pendingGate` (the package's declaration
has no field for one). Harmless while no consumer declares one.
