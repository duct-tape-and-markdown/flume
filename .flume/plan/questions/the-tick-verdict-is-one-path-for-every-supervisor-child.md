# `tick-verdict.json` is one path, and above a budget of one two children share it

**This is the gate on raising `supervisorPolicy.maxTicks`** — the knob the
build-order ruling (2026-09-24) left to the operator.

`spec/loop.md`, *The tick verdict — one facts artifact*: "`<flumeDir>/tick-verdict.json`
holds this tick's verdict alone, cleared before the tick's own work begins so a
tick that never reaches the write ... leaves nothing the supervisor can misread
as its own." Written for one child. `src/paths.ts:435` is a single constant.

With `maxTicks > 1`, every `flume tick` child clears and writes that same path
and the supervisor reads whichever was last. The run's shipped tags, errored
ticks, spend rows, quarantine set and abort streak all come off that read, so
above one they are **silently lossy** — an undercount, not a crash. Nothing
regresses today because the default is one.

`SIBLING-TICKS-TAKE-TURNS-AT-GIT` does not cover this: that entry guards git;
this is the fact channel.

The forks, cheapest first:

- **Key the filename by phase** — `tick-verdict-<phase>.json`. The supervisor
  already knows which phase each child is for (it spawns `tick --phase <name>`,
  `src/loopSupervisor.ts:946`), so the reader side is decidable. Clearing stays
  per child. Costs: the path is no longer a constant a human or a chain can
  name, and `flume status`/recovery readers that open it by name need the phase.
- **The supervisor hands the child its path** — an env var or a flag. Keeps one
  reader-writer pair per child with no naming convention, but adds a
  supervisor→child contract and a fresh spelling of "where this tick writes".
- **Append-only, and drop the single-verdict path** — read the run's facts out
  of `tick-verdicts.jsonl` filtered by pid or phase. One path, no keying, but
  the jsonl is bounded to a rolling 200 and is explicitly "history, never
  cleared", so the "nothing the supervisor can misread as its own" property has
  to be rebuilt on top of it.

The shape looks mechanical, but which keying is spec's to say, and whichever
lands is contract-touching: a resident supervisor and a fresh child must agree
on it.
