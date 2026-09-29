# Does `flume loop`'s completion summary name a run that shipped nothing, or is the exit code the whole operator signal?

From A-CLEAN-EXIT-WALL-IS-THE-BUDGETS-NOT-THE-BACKSTOPS's note: a run whose
every tick was a `clean-exit` — a build agent that looked at its entry and
refused — burns the whole `--max` budget and finishes looking healthy. The
note framed this as a missing fact on `SuperviseResult`; it is not, and the
sharpened version is narrower.

**What the tree actually does**, verified this tick:

- The supervisor's `errored` fold (`src/loopSupervisor.ts:740`) deliberately
  omits `clean-exit`, and the comment above it (`:671`) names the exclusion as
  decided rather than overlooked. So `erroredTicks` is empty, `repeatedFailure`
  undefined, `hibernated` false.
- `loopExitCode` (`src/cliVerdict.ts:225`) returns 0 — non-zero needs an
  errored tick. `spec/loop.md`, *Exit codes — the run never lies to CI* states
  this outright: "Settled with nothing to do" stays 0. **The behavior is the
  spec's, so there is no entry to file against it.**
- The fact is **already on the API**: `SuperviseResult.shippedTags` accumulates
  every tag the run shipped, so a chain reading the result can tell a
  shipped-nothing run from a productive one without help.
- The gap is one layer out, at the **CLI's own summary**.
  `src/cliVerdict.ts:286` names `shippedTags` only inside the
  `erroredTicks.length > 0` branch. With zero errors the summary emits no
  shipped segment at all — an all-clean-exit run that spent a full budget of
  agent invocations prints the agent-usage line and `reached --max N;
  stopping`, byte-identical in shape to a run that shipped four entries and
  simply ran out of ticks. `spec/loop.md` asks the summary for the errors and
  the spend, and never for what shipped.

So the decision is about the operator surface, not about mechanism, which is
why it is here rather than in the queue.

**(a) Leave it. The exit code and the spend line are enough.**
An operator who wants to know what a run shipped reads `flume status` or the
ledger; the summary exists to surface what would otherwise vanish (errors,
cost), and "nothing to do" is a legitimate quiet outcome the loop reaches on
every hibernation.

- Cost: the one no-commit mode with **no bound short of the whole budget** is
  also the one with no distinguishing output. A build phase walling on every
  pick — a queue of entries already shipped, a fence that refuses every
  candidate — spends a full budget of agent invocations and reports as a
  healthy idle run. The spend line is the only tell, and only to someone who
  knows what the run should have cost.

**(b) The summary names what the run shipped, unconditionally.**
Lift `shipped ...` out of the errored branch and give it an explicit
nothing-shipped spelling, so every completed run states its yield. Smallest
change; no new field, no exit-code move.

- Cost: one more segment on every summary, including the ordinary hibernation
  where it says nothing interesting. And "shipped nothing" still does not
  separate *hibernated with an empty queue* (correct) from *walled on every
  pick* (not), since both ship nothing.

**(c) The summary distinguishes the two quiet endings.**
Report the count of ticks that ended `clean-exit` beside the spend, so
"budget spent, nothing shipped, N agents refused their entry" reads
differently from "hibernated, nothing to do". This is the note's instinct
made concrete, and it is a **fact, not a verdict** — it would sit beside
`erroredTicks` on `SuperviseResult` and stay out of `loopExitCode`, which
keeps `engineering.md`, *A fact the engine holds is reported, never
rediscovered* satisfied without making a clean exit into a failure.

- Cost: a new `SuperviseResult` field for a reporting-only purpose, and a
  judgement call on where the count is derived — the verdicts are already
  folded in `runVerdicts`, so it is cheap, but it is still surface the engine
  did not need.

I did not pick: (b) and (c) differ on whether flume wants an operator-visible
name for *walled on every pick*, and that is a product call. (a) is defensible
and is what ships today.

Nothing blocks on this: no queue entry depends on the answer, and the
behavior is correct against the spec either way.
