# The continuation thresholds are 70% and 80%, and a build agent chose both

From note `A-CONTINUING-NOTE-IS-A-THIRD-NOTE-HOME`, which flagged them for a
human read. Re-verified on disk this tick: `harness/prompts/build.md:31`
reads "At **70% of the window**, open no new ground… At **80%**, stop" and
carries a clause for a chain that declared no window.

## Why nothing else can answer it

`spec/harness.md`, *A tick puts work down* says only that "the build prompt
names the thresholds at which an agent lands what is green and writes the
note" — deliberately no numbers. `spec/chain.md`, *The agent seam* mentions
eighty percent once, and in passing ("what an agent does at eighty percent
is the prompt's to say"). So 80 has a thread of spec behind it; 70 is the
build agent's own invention, and nothing mechanical holds either. This is
the experiment's dial, and the ladder has no rung for it: a threshold is a
judgment about how much room a coherent segment needs, not a property a
type, pin, or gate can decide.

## The evidence that would settle it does not exist yet

The section's own *Why* names the measurement: "reverts and parks per
shipped entry, plan's share of agent time, and the median build invocation,
before and after." The budget line itself is unshipped —
`THE-BUDGET-LINE-IS-READ-OFF-THE-TRANSCRIPT` and
`THE-ADAPTER-REGISTERS-THE-BUDGET-HOOK` are still in the queue — so no tick
has yet seen a budget line, and the verdict log holds no after-side. Until
it does, any number is a prior.

## The forks

1. **Keep 70/80 as the opening prior**, and revisit once the verdict log has
   a few dozen build invocations on both sides. Cheapest; the cost is that a
   wrong prior burns the very measurements meant to correct it — an 80 set
   too low turns entries that would have fit into two ticks each, which
   reads in the log as the feature working.
2. **Start higher (say 80/90)** on the reasoning that a preempt loses a
   segment and an early stop loses a whole tick's throughput, so the
   asymmetry favors late. The risk is the one the section was written
   against: an agent cut off at 95 wrote nothing down.
3. **Make them declared rather than prose** — a per-phase number in
   `.flume/declaration.ts` rendered into the prompt, so the dial moves
   without an agent rewriting a paragraph. Note this is *not* the same list
   the adapter's `budget.thresholds` carries: the spec separates emission
   cadence ("facts") from what the agent does ("the prompt's to say"), so
   folding them into one value would be wrong. Two declared lists, or one
   declared and one prose.

I have no basis to pick between 1 and 2 and did not. 3 is orthogonal and
composes with either.
