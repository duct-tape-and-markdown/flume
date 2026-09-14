# The gate-failure literal is written out four times in Dispatcher.ts

Adding one optional field to a gate's failure detail took five edits in
`src/Dispatcher.ts` alone: the type literal `{ gate; message; details?;
failingFiles? }` is spelled inline four separate times (singleton
afterMerge's `entryFailure`, the fanout wave's `entryFailure`,
`runAfterCommitGates`'s `failure?` return, `revertAfterCommitFailure`'s
`failure` param) plus three near-identical conditional-spread blocks that
build it.

`buildGateRevert` in `src/priorAttempts.ts` already declares the same shape
a fifth time as its own parameter — and that one is the real consumer of all
four. A named exported type there, imported by the dispatcher, would make
the next field on `GateResult` a two-line change and would stop a site from
silently dropping a field the other three carry (nothing today would catch
it: the shapes are structurally compatible either way).

Pure shape, not correctness-adjacent — accepted debt unless a future field
makes the drift real. Files under `engineering.md`, *The fix lands at the
mechanism*.
