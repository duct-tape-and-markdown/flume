# gatedTip now parts from commitSha on two unpinned arms

Shipped as written: the singleton leg sets `gatedTip` from the carry's own
`mergedSha` in the `merged` arm (`src/singletonTick.ts`), and
`commitAttemptLedger` (`src/waveMerge.ts`) now returns the rewrite's exit so
`land` withholds the read on `tip-claimed` alone.

Two reachable states no case pins, both where `gatedTip` and `commitSha`
disagree:

1. A singleton whose span trunk already held — `merged` with
   `mergedSha === landedOnSha` — now reports `gatedTip` with **no**
   `commitSha` and `committed: false`. That is the absorbed arm
   (spec/loop.md, *Tip verify — one writer per branch, absorption at the
   merge*), and reading it as "shipped nothing" would be wrong: the span is
   on trunk and the gates judged that tip. Declared at the site; nothing
   asserts it. A `handoff` keying a delivery step on `committed` rather than
   on `gatedTip` would skip a tip every gate passed.
2. The rewrite's other two no-commit exits — `nothing-to-write` and
   `dock-outside-repo` — still take the tip read, which is what spec/loop.md
   says (only a foreign tip claim withholds). Nothing pins that they do, so
   a future narrowing of the `exit !== "tip-claimed"` test to
   `exit === "committed"` would ship green and silently drop the gated tip
   for a relocated dock.

Also hoisted `waveRefusedByTipClaim` out of its describe to module scope
(`tests/Dispatcher.test.ts`) so the new fanout case reuses the one arming
rather than spelling the tip-claim layout a second time.
