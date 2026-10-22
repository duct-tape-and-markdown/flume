# The exit stage landed, and it exposed one upstream hole

Shipped: `exit` joins `FAILURE_STAGES`, composed in `superviseLoop` from
`exitCode !== 0 && verdict === undefined`, keyed by `String(exitCode)`, no
tag. Roster prose re-homed everywhere the pins read it back; `stageWord`
(`tests/docComments.test.ts`) needed an `exit` fence against
`exited`/`exits`/`exitCode`.

Two structural moves the entry did not predict, both pinned:

1. The abort block now sits **after** the 78 and 69 legs, not before. A
   declined 69 is itself a verdictless exit, so three of them put the streak
   at the threshold exactly as the mount wall can come back — read the
   backstop first and a run whose mount is dead *now* exits `1` for having
   repeated instead of `69` for the wall. New case: "a 69 whose wall is back
   on the threshold tick ends the run mount-dead, not on the backstop".
2. The errored-tick line moved **above** the abort, to the record's own site
   (the record's `message` is the line — one spelling). The abort `continue`s,
   so counting it later dropped the aborting tick from `erroredTicks` and red
   the standing LOOP-ERRORED-TICKS-SILENT-EXIT case.

**Finding for plan — a stale verdict can mask a verdictless exit.** The
condition is "no verdict on disk", and that is only true because `cliTick`
runs `clearTickVerdict` early. A child that dies *before* that — node or tsx
failing to start, the `usage:` refusal above the clear — leaves the
*previous* tick's verdict for this phase standing, and the supervisor reads
it as this tick's: no `exit` record composes, and that verdict's facts are
counted again. Pre-existing (the old `!countedAsErrored` guard had the same
hole) and now load-bearing for a whole stage. The engine fix is one of: the
supervisor clears the phase's verdict before it spawns the child, or the
verdict carries a per-tick identity the supervisor can check it against.
Second looks better: a fact, not a pre-emptive write.
