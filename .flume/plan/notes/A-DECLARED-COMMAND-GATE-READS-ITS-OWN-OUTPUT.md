# The reader landed on the engine's gate, and spec/chain.md still says otherwise

The declared reader is a capability on `shellGate` (`read?: ShellGateReader`,
`src/builtinGates.ts`): the engine captures both streams and the exit status,
the declaration supplies the function, `harness/declaredGates.ts` passes it
through and decodes nothing itself. The harness could not hold it — `details`
folds the two streams, so a reader standing on the harness side would be
re-parsing an engine fact.

**`spec/chain.md`, *The builtin gates* now contradicts the engine.** Its
`shellGate` row reads "Verdict is exit code alone, and so is blame: no
shell-backed gate observes a base, so none can declare `blamesSpan: false`",
and its signature line lists no `read`. `spec/harness.md`'s declaration row
demands exactly that blame from a command gate's reader, so the two pages
already disagreed on the base tree; this entry shipped the `harness.md` row.
Settling `chain.md` is a human's — either the row grows `read?` and drops the
blame sentence, or the reader does not belong on `shellGate`.

Two decisions inside the entry's shape, both declared at their sites:

- A command that reached **no exit status** (spawn failure, signal, a
  `maxBuffer` overrun) fails the gate *without* asking the reader, and the
  message says so. A reader handed an empty document would rule an un-run
  command clean.
- `details` falls back to the captured output where the reader states none —
  the tree is gone by the time anyone reads the verdict. A reader that
  distilled the output keeps its own.

Re-homed in this commit: `GateResult.failingFiles` and `GateResult.blamesSpan`
(`src/Gate.ts`) each claimed no shell-backed gate can state them.

The entry's rejected alternative holds: the `registry` arm carries no `read`
(a built gate's verdict is that gate's), so exit-status-alone is one mechanism
over no reader rather than a `kind` of its own.
