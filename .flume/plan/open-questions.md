# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `spec/worktrees.md`'s narrowed "Node-child spawn" trigger is pervasive in `tests/cli.test.ts` and `tests/job.test.ts`'s default-lane `runCli` usage (residual sweep, 2026-08-18)

Status: PARKED

Follow-on to the resolved "real git" over-approximation question (closed `44e7216`, which named
Node-child spawns, real agent invocations, and wall-clock timing assertions as the integration
lane's actual cost drivers, with "any remaining default-lane Node-spawn or timing probe" flagged
as a residual sweep to run).

Ran that sweep this tick: `tests/helpers/subprocess.ts`'s shared `runCli` helper spawns a real
`node <tsx-cli> <cli.ts> ...args` child per call — exactly the newly-named "Node-child spawn"
trigger — and is used ~98 times in `tests/cli.test.ts` alone, plus more in `tests/job.test.ts`.
Both are **default-lane** files (not `*.integration.test.ts`). Taken literally, the narrowed
spec text still puts most of both files in the integration lane — the same over-broad-reading
shape the git narrowing just fixed, one level in.

Difference from the resolved git case: no flake has ever been reported against these
`runCli`-driven tests. They exercise single-invocation argv parsing, exit codes, and output
shape — not multi-tick/multi-wave engine behavior — and have no way to test process-level
behavior (an exit code, stderr text) without spawning a process at all.

Options:
- Narrow further: state the trigger as spawning `flume tick`/`loop` to drive multi-tick/engine
  behavior specifically, leaving single-invocation CLI-surface tests (which must spawn a
  process to test process-level behavior) compliant as practiced. Closes with no code change,
  symmetric with how the git question closed.
- Leave "Node-child spawn" as written and treat `cli.test.ts`/`job.test.ts`'s `runCli` usage as
  accepted, pre-existing debt — but per the same reasoning that closed the git question, a
  reading that contradicts near-universal practice with zero measured flakes reads as
  aspirational rather than descriptive.

No recommendation — same calibration-not-research fork as the resolved git question: needs a
human read on whether "Node-child spawn" was meant to reach single-invocation CLI-surface tests
at all, or only multi-tick engine-behavior spawns.

**Answered (2026-08-18, human sign-off via interactive session):** option 1, and the spec is
already amended — the trigger is spawning `flume tick`/`loop` to drive multi-tick or engine
behavior; a single-invocation CLI-surface spawn is the test's subject, not overhead, and is
compliant as practiced. Truthful to measurement: every flake was an engine-behavior spawn or a
timing probe; the ~100 `runCli` surface tests have never flaked. Question closes with no code
change.
