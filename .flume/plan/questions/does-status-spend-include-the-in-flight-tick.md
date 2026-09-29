# Does `flume status`'s spend row reach the in-flight tick, or say that it does not?

From the inbox record *a refilling build wave outlives the code it launched
with*, defect 3.

## The gap

`spec/cli.md`, *`flume status` owes exactly this*, row 7: the live run's spend is
"agent usage totalled by phase from the verdict rows written since the instant
the lock states it started", and the row exists because "the number that decides
whether a loop keeps running is read where the operator looks first."

Measured, loop of 2026-09-28T22:59Z: a build wave refilled its slots for ~4h in
one tick. Row 7 read **$6.93** while the run had spent **~$211** — correct by
the letter (one verdict row had been written), and wrong for exactly the
decision the row exists to serve.

The mechanism is why: `invocations[]` reaches disk only when the tick writes its
verdict, so a long wave's spend is invisible until it ends. A verb reading
verdict rows cannot do better without a new artifact.

## The fork

1. **State the bound in the row** — the line names what it excludes ("excludes
   the tick in flight since <instant>"), so the operator reads a floor rather
   than a total. Cheapest; the number stays wrong but stops lying.
2. **A usage row lands per agent, not per tick** — the wave appends each
   invocation's usage as the agent returns, and row 7 totals those. Makes the
   number true; costs a second artifact (or an append-only usage log beside
   `tick-verdicts.jsonl`) and a bound on it.
3. **Leave it** — the completion summary totals the run, and an operator
   watching cost watches the loop's own output.

1 and 2 are not exclusive: 1 is worth doing whichever way 2 goes, since even a
per-agent row is stale between agent returns. I would not pick 3 — the row's
stated purpose is the one this failure hits. Which of these is `spec/`'s to say
is yours.
