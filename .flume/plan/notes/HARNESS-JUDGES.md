# The judge's green-on-base fact stops at the gate's string wall

The judge reports green-on-base structurally (`outcome`, per-line `state`),
but that alone does not retire `.flume/chain.ts:632`'s regex as the entry
expects. That regex reads `rec.message` off `TickContext.priorAttempts`, and
the record (`src/priorAttempts.ts`, `buildGateRevert`) carries only
`gate`/`message`/`details` strings — `GateResult` has no structured verdict
field, so the judge's outcome is flattened before the next plan tick sees it.
Closing it needs the fact to survive the gate → record → next-tick hop: a
`GateResult` field the engine persists verbatim. Whether that is engine
mechanism or the chain's own business is a boundary call nobody has made.

Second: `judgeNamedLines` and `vitestRunner` have no case composing them.
Each side is pinned alone — `tests/harnessJudge.test.ts` over a stand-in
runner, `tests/harnessRunner.test.ts` over real vitest. The entry that wires
the judge into a gate is where that end-to-end case belongs.
