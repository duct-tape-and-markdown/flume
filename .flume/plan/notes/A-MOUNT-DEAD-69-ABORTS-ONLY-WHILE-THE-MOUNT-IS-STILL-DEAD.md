# The mount-dead re-read needed a third leg the spec's sentence does not name

spec/loop.md, *Exit codes - the run never lies to CI*, names two legs for the
re-read: the chain's resolution and the queue's parse. `src/` has a **third**
69 producer: `readPhaseTemplate` (`src/Prompt.ts`) refuses a phase whose
declared prompt file will not read, and `tickExitCode` (`src/cliVerdict.ts`)
classifies that refusal 69. The same section's 69 row does not mention it
either - it lists chain load, missing state root, invalid declaration, ledger
parse.

Built with two legs, `flume loop` stopped halting on an absent prompt file:
the chain resolves and the queue parses, so the supervisor declined the abort
and the run burned every `--max` child on one unreadable file. That halt is
pinned end-to-end ("flume loop halts on a phase whose declared prompt file is
absent rather than spending its remaining ticks", `tests/cli.test.ts`), so the
two-leg reading reds the suite.

Shipped with the prompt leg included, keyed by the exiting child's own phase,
and a supervisor-level case for it beside the entry's four. **For the human:**
either the spec sentence and the 69 row should name the prompt leg, or the
prompt refusal should stop being 69. I took the first reading - it keeps every
shipped guarantee - but the divergence is real and is a spec edit, not mine.

Second thing, smaller: `scanSpawns` (`tests/helpers/spawnBudget.ts`) is
scopeless, so a stub named `runTick` that yields on `setTimeout` makes *every*
`runTick` in the file timer-reaching. My cases spawn `git` to commit a queue,
so they read as spawn-then-sleep. Fixed by renaming the two timer-yielding
stubs in `tests/loopSupervisor.test.ts` (`runTickYieldingOnce`,
`runTickHoldingTwo`); the collision will recur for any file that pairs a
spawning case with a timer-yielding stub of a shared name.
