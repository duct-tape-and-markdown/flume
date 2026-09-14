# The `clean-exit` rename disarms consumer brakes silently (consumer-chain survey)

Two surveyed chains compare a no-commit mode against the literal
`"voluntary-bail"`. 0.15.0 renamed it. Neither comparison fails loudly.

- A redispatch brake reads `prior-attempts/<slug>.json` off disk and casts
  `{ mode?: string }`, so `record.mode !== "voluntary-bail"` is now always
  true and the brake returns its permissive default. `PriorAttempt`'s shape is
  engine-private; no consumer can narrow it. (platform bay `.flume/chain.ts`
  `build.shouldRun`, pinned 0.14.0)
- A build `handoff` tests `result.noCommit !== "voluntary-bail"` to decide
  whether a clean bail wakes plan. `noCommit` IS typed, but `!==` against a
  union member TypeScript permits. (cartograph `.flume/chain.ts:590`, ^0.12.0)

Why it matters: the brake exists because one entry burned four bails against
an unchanged world; the handoff exists because before 0.8 a bail was
indistinguishable from a no-op. Both costs return, unannounced.

Fork: publish `PriorAttempt`'s type so the disk record narrows, or state in
MIGRATING that mode comparisons are unguardable chain-side.
