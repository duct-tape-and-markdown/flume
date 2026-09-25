# The wave has no budget of its own to put itself down with

`entry.acceptance` named two stop conditions: nothing pickable, or "its budget
says to put the wave down". The engine holds only the first. `tickTimeoutMs` is
per *agent invocation*, and `maxTicks`/`--max` count tick processes, so nothing
bounds a wave's own wall clock. A tick now runs until the queue runs dry, where
before it ran one batch — so `superviseLoop`'s tick budget stopped being a
proxy for wall clock. I wired the one engine-side stop that exists: an aborted
`AttemptContext.stopSignal` refills no further slot (`src/waveTick.ts`,
`fillSlots`). If a wave-level budget is wanted, it is a chain-overridable
policy knob nobody has declared and I did not invent one.

Second: `BatchSelection.batches` past index 0 now has one reader,
`Dispatcher.render`'s preview. The wave never reads `batches` at all — it opens
`maxParallel` slots off `pickable` and the greedy fill reproduces `batches[0]`
exactly. So the preview shows a shape the tick no longer follows: it names
"batch 2" for entries the tick will ship anyway. Either the preview reports
slots-and-remainder, or `batches` shrinks to the initial fill. A shape finding,
not correctness — filing it here rather than guessing.

Third, on the suite: four default-lane cases were pinning "the batch is a ship
limit" as their observable for `maxParallel` / `partitionIgnore`. They now read
the declaration off agent concurrency (`probedFanoutAgent`, the barrier
discipline the ISO case already used). `TickResult.entries` is explicitly
re-sorted into queue order at the fold, because `perEntry` now fills in agent
finish order and two cases legitimately pin queue order.

One flake to name: of six full-suite runs under a 0-60ms merge-enqueue jitter,
run 4 failed one case — while I was running `tsc` concurrently on the same box.
Five runs clean, and I could not reproduce it in two more. Not identified.
