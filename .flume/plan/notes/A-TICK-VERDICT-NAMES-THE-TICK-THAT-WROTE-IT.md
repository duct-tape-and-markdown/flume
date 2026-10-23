# The identity crosses the runTick seam, and a stub that drops it goes quiet

Shipped as specified: `TickVerdict.tickId`, stamped by `writeTickVerdict`
from what `tickVerb` was handed (`FLUME_TICK_ID`) or minted; the supervisor
mints one per child, hands it on `TickChildRequest`, and `readTickVerdict`
answers only for it.

Two things the next plan tick should know.

1. **The stub seam is now silent on omission.** Every `runTick` stub in
   `tests/loopSupervisor.test.ts` had to echo the handed `tickId` into the
   verdict it writes (~50 sites, mechanical). A stub that forgets does not
   fail loudly — the supervisor reads "no verdict" and the case reds on
   whatever it was asserting instead. A `writeChildVerdict(flumeDir, child,
   over)` helper in `tests/helpers/dispatcherFixture.ts` would make the
   stamp unforgettable, and `childVerdictPath` + `verdictFixture` would fold
   into it. Debt, not a defect: nothing is wrong on the tree today.

2. **`tickId` is the one `TickVerdict` field `buildTickVerdict` never
   composes** — it is the writer's stamp, not a fact the dispatcher holds.
   The conditional-fact roster the two-producer comparison reads
   (`tests/Dispatcher.test.ts`) therefore carries it as "unreachable", which
   stretches that roster's claim from "omitted when empty" to "omitted when
   empty, plus one the builder cannot reach". The alternative was threading
   the identity through `DispatcherOptions` → the wave/singleton facts the
   way `ownTipClaimPid` already travels, so the shaping stays whole; that is
   a wider change than this entry scopes, and worth a decision rather than a
   drift.

`writeTickVerdict`'s `tickId` is optional so the writer's own unit tests
keep driving it for file shape; the real CLI always passes one, pinned
end-to-end in `tests/cli.test.ts` (real `flume tick` → real
`readTickVerdict`).
