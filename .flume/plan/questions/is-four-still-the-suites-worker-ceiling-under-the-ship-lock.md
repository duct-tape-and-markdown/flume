# Is `maxWorkers: 4` still the suite's ceiling, now that the ship lock serializes it?

Two comments price the test suite on a premise that has been retired, and
neither can be honestly rewritten without a ruling on the number itself.

## What changed

The suite is the package's `afterMerge` judge (`harness/judgeGate.ts:75`), and
`afterMerge` gates run under the ship lock — **one suite at a time, whatever the
wave's width** (`spec/loop.md`, *The ship lock and the worktree lock — sibling
ticks take turns at git*). The authoring page now states exactly that and prices
it (`docs/CHAIN-AUTHORING.md`, *What a wave costs in memory*): `vitest run` peaks
**~3.2 GB across ~40 processes for ~3 min**, multiplying with nothing.

## The two sites

1. **`vitest.config.ts:26-30`** — the `maxWorkers: 4` warrant reads "a build wave
   runs one suite per entry in parallel, and one worker per core across two waves
   has taken a shared 11 GB host to the OOM edge twice. Four workers is a measured
   ceiling, not a tuning." The first clause is false now, and it contradicts the
   page the same wave shipped. The ceiling may also be leaving headroom on the
   table: the measurement behind it assumed concurrent suites.
2. **`.flume/declaration.ts:95-100`** — the supervisor comment carries the same
   four-wide-OOM history. It is *consistent* with the above rather than wrong, but
   it is paired to it: if 1 is re-measured, 2 moves with it. No phase can write
   this file (build's fence, `.flume/declaration.ts:15-56`), so its half is yours
   either way.

## Why this is a question and not an entry

The prose fix is one line, but rewriting the warrant requires knowing whether 4
is still right — a build tick that restates the ceiling as "measured under the
ship lock" would be inventing a measurement nobody took. The number and the
sentence move together.

## Options

- **(a) Keep 4; restate the warrant as the condition, not the era.** Prose only,
  build-shippable the moment you rule: state the live figures (suite ~3.2 GB
  serialized; host 11 GB) and the condition that would change the decision,
  per `.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*
  ("Prefer the condition to the era"). Costs nothing, keeps the headroom, buys
  no wall clock.
- **(b) Re-measure and raise.** Worst case today under `{ maxTicks: 2,
  maxParallel: 2 }` is one suite (~3.2 GB) beside three agents and two tick
  children (~1.35 GB total) ≈ 4.6 GB of 11 GB — roughly 6 GB unclaimed while the
  suite runs, on a 20-core host capped at 4 workers. Needs a measurement on your
  host, and the failure mode is the kernel's, not a gate's (the page says so:
  no verdict, no quarantine, and the casualty need not be the over-committer).
  `minWorkers` rides with the ceiling, and the figure in the page's worked-example
  table moves too.
- **(c) Drop the cap to vitest's default (core count).** ~3.2 GB at 4 workers
  extrapolates far past this host at 20. Not recommended.

## Recommendation

(a) now, (b) only if suite wall clock is actually hurting — ~3 min per merge is
the figure to beat, and the page already reports it. Whichever you take, both
sites move in the same commit.
