# Two wrappers now spell "wrap a batching gate, hold it to one span"

`shellGate` returning `BatchingGate` reached two wrappers, not one. Beside
`shellCommand` (`harness/declaredGates.ts`), which the entry named,
`judgedByEntryTests` (`examples/cascade-chain.ts`) wraps a suite gate and
reads `ctx.entry` — a per-span fact a batch withholds — so it took the same
treatment: parameter widened to `Gate`, `batches: false` spelled on the
returned gate, `run` pinned to `GateContext`. Two sites is not yet a
mechanism, but a third wrapper of a batching gate that reads a span fact
would be: the shape is "spread a gate, narrow the declaration, keep the
identity", and nothing in `src/` offers it.

Two surfaces a chain can still narrow silently, neither in this entry's
scope:

- `gateFacts` (`harness/declaredGates.ts`) is why a declared `shell`/`script`
  gate stays serial: `FLUME_BASE_SHA`, `FLUME_LANDED_ON_SHA` and
  `FLUME_TOUCHED_PATHS` are one span's, and an env var has no batch spelling.
  A consumer that declares a command gate and raises
  `supervisor.mergeBatch` gets the serial carry with nothing saying so.
  `spec/harness.md`, *What a consumer declares* does not state this — a
  sentence there (or a batch spelling for the facts, e.g. one var per span
  index) is a human call.
- `pendingGate` takes `when: "afterMerge"` and declares no batch, so a chain
  that places the claim check where it bites narrows the phase back to one
  span per merge. It reads `touchedPaths`, `stateRootRel`, `repoRoot` and the
  gated commit — every one of them on `BatchGateContext` — so this one may be
  a real candidate rather than a declined one.

Lane note: a bare `"pnpm"` string literal in `tests/gateBatch.test.ts` reads
as a spawn site to `tests/helpers/spawnBudget.ts` even where nothing runs the
gate, so the fixture names a script path instead.
