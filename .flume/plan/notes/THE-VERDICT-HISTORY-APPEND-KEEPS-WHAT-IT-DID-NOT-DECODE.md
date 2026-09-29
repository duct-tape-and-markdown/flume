# The append preserves lines, so the bound is now over lines

Shipped: `writeTickVerdict` (`src/tickVerdict.ts`) reads the log's raw lines
(`readVerdictLogLines`) and appends `JSON.stringify(verdict)` to them, instead
of re-serializing what `readTickVerdicts` decoded. `readTickVerdicts` and
`readLatestVerdictsSync` now share `verdictLogLines` + `decodeVerdictLine` with
it, so there is one spelling of "split the log" and one of "decode a row".

Two consequences plan may want to look at, neither filed:

1. `MAX_TICK_VERDICTS` bounds the file's **lines**, which now includes rows no
   reader can decode — a row from a pre-`timings` engine, and also a truncated
   final line left by a write that died mid-flush. Such a line is preserved for
   200 ticks rather than dropped on the next one. That is the intended trade
   (declining is a read-side statement, not a licence to delete), but it means
   the window is no longer "the last 200 readable verdicts"; `spec/loop.md`
   says "bounded to a rolling 200" and is silent on which, so nothing is out of
   agreement — only under-stated.
2. The same defect shape exists wherever a writer rewrites a whole artifact
   from records its own structural check accepted. I did not sweep for it here.
   `src/priorAttempts.ts` and the worktree registry (`src/worktrees.ts`) are
   the two other read-modify-write artifacts; both looked like per-record files
   rather than whole-file rewrites on a glance, but that glance is not a
   finding and I did not verify it on disk this tick.

Test: "the verdict history append keeps a record the structural check
declines" (`tests/Dispatcher.test.ts`), red on the base — the pre-`timings`
row is gone from the file after the next append.
