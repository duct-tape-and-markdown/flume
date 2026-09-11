# The same fixture-folded handoff sits on flume's own chain

Shipped: `tests/examples.test.ts` walks every cascade plan rung off six real
`Dispatcher.tick()` outcomes — 615ms, fast lane, stub agent that only commits.
A real dispatcher drive of a singleton phase is cheap; that was the doubt this
entry carried, and it is settled.

Two things for the next derive:

1. **Same defect, our chain.** `tests/chain.test.ts:231-296` drives
   `.flume/chain.ts`'s ladder (inbox/derive/sweep/build) over a hand-authored
   `result(...)` — the exact shape this entry retired for cascade. An
   engine-side rename of `pickableAfter`/`noCommit`/`entries[]` still ships
   green there. The technique above transfers as-is for the three singleton
   slices.

2. **Accepted debt here.** The build wave's own legs in `examples.test.ts`
   stay hand-authored: driving one costs a fanout tick whose afterCommit gates
   shell `pnpm tsc` and eslint per entry — the lane boundary's measured cost
   (spec/worktrees.md). Declared and cited at the site. An integration-lane
   drive is the only way to close it.
