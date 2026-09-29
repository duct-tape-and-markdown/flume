# The handoff refusal has no spec sentence, and a fixture chain still re-reads the var

Shipped: one decode (`decodeTipClaimHandoff`, `src/cli.ts`) answers the pid,
the acquire, and `supervisedRun`; a present value that is not a decimal pid
refuses exit 1 before the Dispatcher is constructed, so `render`, `tick` and
`loop` all get it.

Two things for the next plan tick.

1. **No spec sentence covers the new refusal.** `spec/loop.md`, *The loop lock
   and the tip claim* names the handoff (`FLUME_TIP_CLAIM_HELD=<pid>`) and two
   exit-1 refusals beside it (a live-held claim, detached HEAD), but says
   nothing about a handoff value that names no pid. The behavior is ratified by
   this entry's acceptance, not by a spec line, so the spec and `src/` now
   disagree by omission. Human-directed edit; I did not touch `spec/`.
   Exit code 1 was chosen to sit with the sibling refusals rather than
   widening `EX_TERMINAL_MISCONFIG`'s Axis-C meaning — worth confirming when
   the sentence is written, because a loop child exiting 78 fail-fasts the
   supervisor, which is arguably the right shape for a malformed env every
   later child would inherit too.

2. **Consumer-restatement candidate, in the suite's own fixture.**
   `tests/cli.test.ts` builds a chain whose `supervisorPolicy.killGraceMs`
   reads `process.env.FLUME_TIP_CLAIM_HELD` by truthiness at chain-load time
   to tell the supervisor from the tick child. The engine now decodes exactly
   that fact and hands it to `waveTick` as `TickLeg.supervisedRun`, but no
   chain-facing surface reports it — a chain factory has nothing to read, so
   the fixture rebuilds the decode from the env
   (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
   never rediscovered*). The fixture's reading agrees with the engine's now
   that an empty value refuses ahead of chain resolution, so this is shape,
   not a live defect; it is the third reader of the var and the only one left
   outside the decode.
