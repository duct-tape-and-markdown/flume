# The sync door's bound reaches a child that takes a signal

`captureSync` (`harness/exec.ts`) now spawns under `MAX_CHILD_MS` (5 min) or
a caller-stated `timeoutMs`, and turns node's `ETIMEDOUT` into a refusal
naming the deadline, the command line and the signal. Three observations:

1. **The bound holds a child that takes SIGTERM, and no further.**
   `execFileSync` offers one `killSignal` and no escalation, and the grace
   timer the async door uses (`terminateProcessTree`, `src/processTree.ts`)
   cannot run on a blocked thread. A child that ignores SIGTERM still holds
   the tick. Declared at the site (`KILL_SIGNAL`, `harness/exec.ts`). Closing
   it would take a different door — a `spawnSync` loop, or moving the three
   caller families off the synchronous path — a bigger entry than this one,
   with no measured bite yet.

2. **The cap scan judges by bare name, and a helper inside a spawn home is a
   landmine.** Factoring the retry legs into a helper named `bounded` made
   every unrelated `bounded`/`retained` call in `harness/cursorWindow.ts`,
   `src/renderedPrompts.ts` and `src/tickVerdict.ts` a cap finding, and
   moving the options literal out of the `execFileSync` frame lost the stdin
   verdict too (`tests/spawnCaps.test.ts`). Both are the trade that scan's
   header declares, but the first costs a full-suite round trip to find. The shipped shape builds its options
   beside its call for that reason.

3. **Nothing mechanical holds "a sync spawn declares its deadline."** The cap
   scan holds that posture for `maxBuffer` and for the child's stdin; the
   deadline is held only by `tests/spawnDeadline.test.ts` driving the one
   door. A second sync spawn home in a shipped tree would inherit neither —
   if one appears, the arm belongs in that scan, not a second file.
