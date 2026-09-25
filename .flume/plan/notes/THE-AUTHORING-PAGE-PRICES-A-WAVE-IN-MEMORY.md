# The suite is the dominant memory term, and two comments still price it wrong

Measured on this host (11 GB, 20 cores) while the loop ran: agent 270-300 MB,
tick child ~165 MB, supervisor ~170 MB, whole loop tree at
`{ maxTicks: 2, maxParallel: 2 }` = 1.35 GB. `pnpm tsc --noEmit` peaks 550 MB
for 4 s. `pnpm vitest run` peaks **3.27 GB across ~40 processes** (sampled
process-group RSS, 0.5 s interval), which is more than double the whole loop
tree. The wave's knobs multiply the agents; they never touch the suite.

Two sites price it on the pre-ship-lock model and read as current:

1. `vitest.config.ts` `maxWorkers: 4` comment — "a build wave runs one suite
   per entry in parallel". False now: the suite is the `afterMerge` judge
   (`harness/judgeGate.ts`), and the ship lock serializes those
   (`spec/loop.md`, *The ship lock and the worktree lock — sibling ticks take
   turns at git*). Its premise is retired, and the ceiling of 4 may be leaving
   headroom on the table now that only one suite runs at a time.
   Expired-narration lens, plus a sizing question worth re-measuring.
2. `.flume/declaration.ts`'s supervisor comment carries the same
   four-wide-OOM history. Consistent with the above but paired to it — if 1
   is re-measured, 2 moves with it.

Not filed here: both are prose about the harness's own config, not engine
behavior, and changing `maxWorkers` changes timing, which is outside this
entry.

Seam noted in the entry held: nothing on the authoring page reports per-gate
timing yet, so the page prices memory and says nothing about wall clock.
THE-VERDICT-CARRIES-A-TIMING-PER-GATE-RUN-AND-MERGE is still pending; when it
ships, the new subsection (`docs/CHAIN-AUTHORING.md`, *What a wave costs in
memory*) is where a timing sentence belongs — it already names the ~3 min the
suite costs, which is the figure that entry would make readable per run.
