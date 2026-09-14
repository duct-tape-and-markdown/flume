# TickContext.stateRootRel shipped; the spec bullet still owes a row

`TickContext` now carries `stateRootRel` (`src/Phase.ts`), populated from the
dispatcher's own `computeStateRootRel` on both context builds — the singleton
`ctxFacts` and the fanout per-entry one. `harness/prompts.ts` reads it;
`buildPromptArgs` takes `{ declaration, ctx }` only, and `computeStateRootRel`
has no caller under `harness/`.

Two for the next plan tick:

- `spec/chain.md`, *What a hook receives* still lists only `pickable` and
  `priorAttempts` under the `TickContext` bullet. The field is shipped; the
  row is the human's to add. Until then the spec understates the surface.
- `HARNESS-PHASES` is unblocked on this axis: the factory's build `promptArgs`
  can call `buildPromptArgs({ declaration, ctx })` with nothing but what the
  engine hands the hook — no `FlumeApi.paths.repoRoot` to thread.

Spelled optional (`stateRootRel?: string | undefined`) to match `pickable`'s
hand-built-fixture optionality, so absent-vs-relocated is a distinction only a
fixture can make; a dispatcher-built context always carries the key.
