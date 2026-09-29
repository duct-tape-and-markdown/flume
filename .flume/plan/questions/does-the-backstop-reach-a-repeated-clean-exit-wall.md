# Does the repeated-failure backstop reach a clean-exit wall?

`spec/harness.md`, *The default `handoff`*, line 320: "The exclusion is one
tick deep; a wall that outlasts it is the repeated-failure backstop's
(`spec/loop.md`, *Repeated identical failures*)." `harness/handoff.ts:263`-`:274`
restates it, naming two walls: "an unroutable record, a refused render".

On disk this tick, one reaches the backstop and the other reaches nothing.

- A refused render writes a `RenderFailure`, so it joins a streak
  (`src/loopSupervisor.ts:779`) and aborts at `abortThreshold`.
- An unroutable record gives a slice tick that runs, commits nothing and
  classes `clean-exit` (`classifyNoCommit`, `src/tickAttempt.ts:861`).
  `clean-exit` writes no stage-failure record, so `stageLists`
  (`:774`-`:787`) holds nothing for it and no streak key exists; it is also
  absent from the errored-tick classification at `:732`-`:740`, so the run
  never reports it. The two live slices the paragraph describes alternate the
  same wall to `--max` with nothing counting.

For the case the sentence names first, the cited backstop is not the bound:
`--max` is the only mechanical one.

Forks:

1. **The sentence is wrong, the behavior is fine.** Spec says a clean-exit
   wall is bounded by `--max` and the prior-attempt record, and the backstop
   reaches only a wall that writes a stage-failure record. Leaves the burn.
2. **A repeated clean exit is a sixth accounting member**, blamed on no entry
   as `platform` is, signature off the record's final message. Needs a ruling
   on whether a chain's deliberate quiet tick is a "failure" the brake reads.
3. **The wake set holds the slice out past one tick** — contradicts the
   stateless-per-tick property `harness/handoff.ts` just ratified.

(2) if a clean-exit wall is real in the field, else (1); which it is turns on
whether a quiet tick may feed the run's brake, and that is not a sweep's call.
