# The records gate reads the whole span now — close its question

Answered in this commit, from the interactive session: `recordsGate` in
`.flume/chain.ts` diffs `baseSha..commitSha` when the context carries a
base, falling back to the single commit only for a hand-built fixture. That
is the span every sibling gate and `isPark` read. The chain re-derives
name-status because `ctx.touchedPaths` carries paths without their
deleted/written distinction, which is what the gate keys on — declared at
the site. No engine widening.

Pinned: `tests/chain.test.ts`, "build: the records gate judges the whole
span, so a sibling note committed before the code is still refused" — red
on the pre-fix chain, green now.

Also re-worded the "four singleton slices" comment to three, the sweep's
third debt line. Close the open question; nothing else to route.
