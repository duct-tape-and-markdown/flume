# A consumer's command and the reader of its result are three mechanisms, and the gate one reads only the exit code (downstream consumer report, class)

**Kind.** "Run a command the consumer declared; read a structured verdict out
of what it printed" is built three times in the harness, with three reach
levels. The weakest is the gate: a declared `shell`/`script` gate can say
only pass/fail, though `GateResult` carries `verdict`, `failingFiles`,
`skipped` and `blamesSpan` and the engine persists them verbatim
(`spec/chain.md`, *What a gate returns*).

**Members.**
- Field instance: a reverted shell gate's record has `kind: null`,
  `failingFiles: null`; the retry gets only raw output. Consumer asked for a
  JSON line on fd 3.
- The script runner: declared command + a reader the declaration names
  (`spec/harness.md`, *The runner interface*).
- CI lanes: a declared title reader, pattern or function, over a run's log
  (*CI lanes as a findings source*).
- Shell/script gates (`harness/declaredGates.ts` → `shellGate`): exit code
  only, no reader.

**Owning artifact.** The harness declaration's command-plus-reader shape —
one mechanism with three callers (`engineering.md`, *A module is one job*: a
verdict shape spelled three ways by three siblings has one vocabulary). A
declared gate takes the same optional reader the script runner does, mapped
onto `GateResult`; the exit-code-only gate is that mechanism with no reader
declared.

**Decision for the human.** A reader over output (the existing pattern, no
new protocol) versus a dedicated channel (fd 3, as asked): the reader keeps
one vocabulary; fd 3 separates the verdict from noise at the cost of a
convention every gate author learns. The record recommends the reader.
