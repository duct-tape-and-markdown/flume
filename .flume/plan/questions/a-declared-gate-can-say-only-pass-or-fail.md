# A declared gate can say only pass or fail, where three sibling mechanisms read a verdict

"Run a command the consumer declared, read a structured verdict out of what it
printed" is built three times in the harness, at three reach levels. The
weakest is the declared gate: a `shell`/`script` gate reports its exit code
alone, though `GateResult` carries `verdict`, `failingFiles`, `skipped` and
`blamesSpan` and the engine persists them verbatim (`spec/chain.md`, *What a
gate returns*). Field instance: a reverted shell gate's record has `kind: null`
and `failingFiles: null`, so the retry gets raw output and nothing keyed.

The siblings that already read a verdict: the script runner (a declared
command plus a reader the declaration names, `spec/harness.md`, *The runner
interface*) and CI lanes (a declared title reader over a run's log, *CI lanes
as a findings source*).

**The decision.** How a declared gate states its verdict:

- **(a) A reader over the command's output** — the same shape the script
  runner and the lane reader already take, mapped onto `GateResult`. One
  vocabulary across all three; an exit-code-only gate is that mechanism with
  no reader declared. The record recommends this.
- **(b) A dedicated channel** — the verdict on fd 3, as the consumer asked:
  it separates the verdict from the command's noise, at the cost of a
  convention every gate author learns and a fourth spelling beside the three.

Not plan's to pick: it is the declaration's public surface, and the three
readers are what a consumer learns once. The owning artifact either way is
the command-plus-reader shape with one mechanism and three callers
(`engineering.md`, *A module is one job*), not a fourth gate field.
