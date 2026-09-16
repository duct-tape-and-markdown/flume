# Two jobs left, and the seam needed two more homes

Shipped `src/selection.ts` and `src/tickAttempt.ts` as scoped. Two more
homes fell out of the seam, both forced:

- `src/gateRun.ts` (new) takes `runGate`. It is called by the attempt's
  afterCommit loop *and* by both afterMerge loops that stay in
  `src/Dispatcher.ts`; parking it in `tickAttempt.ts` would have made that
  module's header disclaim its body.
- `src/tickVerdict.ts` takes `throwFacts`, `reportedGateRow`,
  `gateFailureSignature`, `MAX_FAILURE_SIGNATURE` — each spelled on both
  sides of the split, each a constructor of a vocabulary that file already
  declares. Leaving them behind meant a Dispatcher/tickAttempt cycle.

Stale spec cite, human-owned so untouched: `spec/loop.md` ("Ship detection
trusts the agent's own account") names `Dispatcher.AgentTermination`. That
type now lives in `src/tickAttempt.ts`. No pin reads `spec/`, so nothing is
red, but the cite names a home that no longer holds it.

`computeStateRootRel` deliberately stayed put: ~15 paired cites across
`src/`, `harness/`, `tests/` name it there. The attempt reads the folded
verdict off `AttemptContext.configDirRel` instead.
