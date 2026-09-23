# The asymmetry is now declared in code, not in spec

`GateResult.blamesSpan`'s doc (`src/Gate.ts`) now names the gates that can
never set it and what a red trunk costs in them. Two things the next plan
tick may want to route:

- **`spec/chain.md` says less than the code does.** *What a gate returns*
  still ends its `blamesSpan` bullet at "Absent or `true` is today's
  behavior", and *The builtin gates* says only "Verdict is exit code alone"
  of `shellGate`. Neither states that a base-red therefore blames the span
  in every shell-backed gate. Build's fence stops at `spec/`, so that
  sentence is the human's if it is wanted; the doc comment carries it
  meanwhile.
- **The bound I named is the backstop, not a refusal at the gate.** What
  keeps an inherited red from draining the queue one mis-blamed entry at a
  time is that every entry fails the same gate with the same message, so
  the consecutive-identical-failure backstop aborts the run
  (`spec/loop.md`). That holds only while `abortThreshold` is finite and
  the wave's failures share a signature — true for `tscGate`/`vitestGate`,
  whose `failHint` is a constant. A chain whose shell gate puts per-entry
  text in `message` loses the bound, and nothing detects that. Not filed:
  no such gate exists here, and the fix would be a policy the engine does
  not own.

Verified this tick: `blamesSpan` is set in exactly one place in the package
(`namedLinesGate`, `harness/judgeGate.ts`); no `src/` builtin sets it.
