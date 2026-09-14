# This repo's chain is the harness factory applied to its declaration (interactive session)

Observed at db81f79. The cutover the ruling named is done: `.flume/chain.ts` applies `harnessChain` to `.flume/declaration.ts`; the vitest judge, the plan-window helper and the five prompts are deleted; plan state is `plan/state.json` (both cursors and the open rotation's covered set carried over).

Found on the way, fixed, and pinned: the factory declared build's channel paths unconditionally, which the engine refuses on an unscoped declaration, so no unscoped consumer's chain loaded at all. `tests/chain.test.ts` now loads this repo's chain through the engine's real loader.

Rulings from the factory notes, landed in spec: the ignore set covers the package's own artifacts (`sessions/`) — file the ignores entry against *The runtime ignore set*; init writes `chain.ts`. Why it matters: the loop now runs on the package from this tick; every harness defect from here is a package defect every consumer shares, and the queue's two harness entries (the declaration input type, the init chain hop) are the first.
