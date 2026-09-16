# The failure shuts derive and sweep too, and it outlives the repair

Shipped past the entry's `files`. Two observations.

1. Every plan slice declares the queue writable, so the engine's carve-out runs
   derive and sweep over an unparseable queue with `pending: []` as readily as
   the inbox. A derive tick there would rewrite the queue with every entry
   dropped and stamp the cursor over it. Both windows now shut behind
   `queueResolved` (`harness/sliceWindow.ts`); the inbox alone opens on the
   fact. Entry named only `inboxWindow.ts`, so this is the scope I widened.

2. `TickResult.queueParseFailure` is the decide-read's fact, so a tick that
   repairs the queue still reports it and the ladder names the inbox once more.
   That costs one declined tick — the next `shouldRun` reads a queue that now
   parses, says no before provisioning, and its handoff routes on. Declared at
   the site in `harness/handoff.ts`. The alternative would be the ladder
   inferring a landed repair from `pickableAfter`, which the boundary rule
   forbids. If the wasted tick is worth closing, it wants an engine fact
   (a post-tick queue verdict), not a chain-side guess.
