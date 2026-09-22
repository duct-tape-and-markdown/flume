# Does `flume tick`'s exit range admit `EX_IOERR`?

`spec/loop.md`, *Exit codes — the run never lies to CI*, gives `flume tick` a
closed-looking table: 0, 1, 2, 69, 78. No 74. But 74 already reaches an
operator through `flume tick` today — `main`'s bay-discovery arm
(`src/cli.ts`) returns `EX_IOERR` on a `.flume` that is present and
unstattable, ahead of every subcommand — and `spec/cli.md` names `EX_IOERR`
exactly once, for `status` alone. So the table and the shipped range have
already parted; this question is whether the table moves or the code does.

What brought it up: a build tick made `readTickVerdicts` refuse on a history
log that is present and unreadable (previously it read as `[]`, and
`writeTickVerdict` then overwrote the whole history with one row). That throw
is correct, but it escapes the `tick` arm uncaught and reaches `main().catch`
— a raw stack and exit 1 — where every other present-but-unreadable read in
`src/cli.ts` prints a `[flume]` line and returns `EX_IOERR`. The throw also
happens *after* `dispatcher.tick()` has landed its work, so exit 1 there
cannot be told from "the tick itself failed": `tickExitCode(outcome)` is
discarded on a tick whose only failure was recording its own verdict.

## The fork

1. **The table gains a 74 row.** The tick arm classifies the verdict-history
   read like every sibling read, `flume tick --help` and `docs/CLI.md` §
   `flume tick` gain the code, and `TICK_PROCESS_LEVEL_EXIT_CODES`
   (`tests/cliHelp.test.ts`) gains it so the existing agreement pins hold.
   Consistent with `.claude/rules/platform-facts.md`, *Exit codes come from
   `sysexits.h`* ("a caller must be able to classify a failure from the exit
   status without reading logs") and with the bay-discovery precedent already
   shipped. Costs a spec edit — human lane.

2. **The table stands; the tick arm classifies in prose only.** Catch the
   throw, print `[flume] tick: tick-verdicts.jsonl failed to read: …`, still
   return 1. No spec change, no new code in the range, but the operator is
   back to reading logs to classify — which is the thing the sysexits rule
   exists to prevent.

3. **Neither: the verdict write stops being fatal.** Treat a failed verdict
   *append* as a report, not a refusal — the tick's own exit code stands and
   the failure goes to stderr. Cleanest for the "work landed, recording
   didn't" case, but it is a degraded-but-proceeding path and would have to
   be declared and bounded per `.claude/rules/engineering.md`, *Loud or
   nothing*.

A ruling on (1) also settles the wider gap: `log`, `check`, `friction` and
`loop` all return 74 today with no spec sentence naming it, so whether
`EX_IOERR` is a cross-cutting code the corpus states once or a per-verb one
each section names is the same decision.
