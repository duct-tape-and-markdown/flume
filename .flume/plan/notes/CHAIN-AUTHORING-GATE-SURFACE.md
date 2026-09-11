# Three more gate-surface restatements, out of this entry's scope

The doc/type agreement pins landed for `GateResult` and `PendingGateOptions`.
Three neighbouring restatements were verified on disk this tick and left:

- `src/Gate.ts:43-45` — `flumeDir`'s doc still uses
  `join(ctx.flumeDir, "plan", "pending.json")` as its worked example, the
  shape `ctx.pendingPath` (:86-93) retired. `src/` was outside this entry's
  fence; the site is named in the new pin's `unfixed` inventory. Mechanical
  if filed: swap the example for a non-queue path.
- `docs/CHAIN-AUTHORING.md:259-263` — the `interface Gate` block omits
  `command?`, the field a chain reads so its prompt need not restate a gate's
  command line. Same class as the `GateResult` omission; the pin generalizes
  by adding one interface name to the same helper.
- `docs/CHAIN-AUTHORING.md:169` — the quoted `plan` phase shows
  `gates: [pendingParseGate]`, but `examples/cascade-chain.ts:232` (the file
  it quotes) declares `pendingGate({ targetFence: build, extension })`. A
  doc/example agreement claim with nothing comparing the two sides.
