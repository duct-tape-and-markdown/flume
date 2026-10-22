# A breaking harness-declaration change has no lane that can land it

`.flume/declaration.ts` is outside every phase's fence: build writes `src/**`,
`harness/**`, `tests/**`, `docs/**` and the root config files, plan writes only
plan artifacts. So a change to the harness package's declaration *schema* that
makes this repo's own declaration stop typechecking cannot be shipped by any
tick — the typecheck gate reverts the commit, and the entry can only be parked.

Live instance: `THE-RUNNING-LANES-COVERAGE-IS-THE-TOOLS-ANSWER` cuts
`Lane.excludes`, which `.flume/declaration.ts` declares twice. Pre-1.0 posture
forbids the two-step (ship the field unused, cut it later), and the operator has
accepted breaking consumer-declaration changes for this family of rulings.

The class is wider than one entry: every declaration-schema cut meets the same
wall, and the reference consumer is the first consumer each one breaks.

**Options.**

- **(a) Add `.flume/declaration.ts` to build's fence.** One path, named
  literally. Build then edits the environment declaration it was fencing off —
  the file that declares build's own fence, its agents and its gates, so a bad
  edit changes the next tick's containment. A gate could hold the shape (the
  declaration loads, the fence still names the paths plan predicts).
- **(b) Keep it human-only.** A parked entry waits for an interactive session
  to land the declaration edit, then flips to `open`. Honest, and the park is
  already the state; the cost is that every schema cut takes a human's pass and
  sits in the queue meanwhile.
- **(c) Keep the old field accepted-and-ignored for one cut.** The shim
  `spec-plan-build.md`, *Pre-1.0 clean-slate posture*, exists to forbid —
  recorded so the next reader does not re-propose it.

Plan's read: (b) is what the fence already says, so the question is whether (a)
is worth the containment it gives up — whether the parked entry waits for a
human or for a fence line.
