# `mergeFailures` is now the one stage-failure class `TickResult` withholds

The fold landed in `Dispatcher.tick()`, beside the existing `noCommit` fold,
rather than in `waveTick`/`singletonTick`: both legs already hand their
`gateFailures` up on the `TickLeg` outcome, and the dispatcher builds the
verdict from that same value one block later. So the handoff surface and the
persisted artifact read one array, and a singleton's own gate revert is
reported by the same line as a wave's.

Two things a next plan tick may want to decide:

1. **`mergeFailures` is still memory-only from `handoff`'s side.** `TickOutcome`
   and `TickVerdict` carry all three stage-failure classes; `TickResult` now
   carries `provisionFailures` and `gateFailures` and not `mergeFailures`. A
   cherry-pick conflict shows on the handoff surface only as an entry with
   `committed: true, shipped: false, reverted: false` plus a
   `mergeOutcome`, with no signature and no quarantine key — the same
   inference this entry closed for gates. Same `per` cite, same one-line
   fold; it looked in scope but the entry named gates alone, so I left it.

2. **`spec/chain.md`, *What a hook receives* does not name `gateFailures`.**
   Its `TickResult` bullet list enumerates `pickableAfter`, `flumeDir`,
   `configDir`, `baseSha`, `entries`, `provisionFailures`. The new field is
   the human's to add there (entry note says as much); until it is, the spec
   enumeration under-states the shipped type.

No debt observed in the touched code. `resultForHandoff` is now always a
fresh object — it used to be `result` itself whenever `noCommit` was absent —
which no test or consumer compared by reference.
