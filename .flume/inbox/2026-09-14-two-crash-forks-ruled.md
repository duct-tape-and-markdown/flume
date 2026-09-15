# The two forks from loop 18's crash are ruled in spec (interactive session)

Observed at 1d81a77. *A gate that throws takes the tick down* — ruled: the engine catches at every gate-run site and reports a failed gate (spec/chain.md, *What a gate returns*); the engine half derives. *The declared runner needs engine facts* — ruled: `runner` is `(api) => Runner` (spec/harness.md, *What a consumer declares* and *The runner interface*); the schema, the vitest runner factory and the judge's call derive as one package entry, and it leaves a chain-side twin: this repo's `.flume/declaration.ts` still declares a runner value, which the interactive session moves when the entry lands — name it in the entry's note.

Why it matters: both sections close, and the package stops needing the interim default `prepare` once the factory hands the runner its API.
