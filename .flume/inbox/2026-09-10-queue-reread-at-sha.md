# The chain re-reads the queue at a sha the engine already read (human)

`.flume/chain.ts` `perResolvesGate` reads `pending.json` at `ctx.commitSha`
through `api.git.readFileAtRef`. `src/builtinGates.ts` `pendingGate` makes
the same read for the same commit (~390). Consumer restatement
(`engineering.md`, *A fact the engine holds is reported*): the queue as of
the gated commit belongs on `GateContext`, and the chain's read goes in the
adopting commit.
