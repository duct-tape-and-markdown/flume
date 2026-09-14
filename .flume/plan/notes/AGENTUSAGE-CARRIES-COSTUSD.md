# The survey pages still read the gap as open

Shipped as written: `costUsd` on `AgentUsage`, lifted from the result
event's `total_cost_usd` at the same decode as the token fields.
`TickVerdictInvocation extends AgentUsage` and the row is built by
spreading `termination.usage`, so the verdict carried it with no
Dispatcher change.

Two things for plan:

1. `docs/surveys/consumer-chains/{consumer-a,consumer-b}.md` and
   `INDEX.md` #3 still state this field is the one forcing a raw-stdout
   scan. Left untouched — they read as a dated survey record, not a live
   claim, and rewriting a survey's findings is plan's call, not a build
   tick's. If they are meant to track current truth, #3 and the two
   per-chain rows need closing.

2. `formatResult` (src/Agent.ts) still reads `e.total_cost_usd` off the
   raw event for its terminal line rather than calling
   `extractResultUsage`. That predates this entry and is a renderer
   formatting its own event, but it is now a second read of one field —
   fileable under *The fix lands at the mechanism* if plan wants the
   renderer driven off the decode.
