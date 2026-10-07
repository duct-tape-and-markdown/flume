# The fact ships, but nothing in this repo's own chain refuses on it

`TickResult.unresolvedBlockers` now rides every singleton and fanout result
(`src/selection.ts`, `src/Phase.ts`, `src/singletonTick.ts`,
`src/waveTick.ts`), documented in `docs/CHAIN-AUTHORING.md` under the
`isPickableNow` passage in section 7.

Three things for the next plan tick:

1. **No consumer yet.** The harness's default handoff
   (`harness/handoff.ts`) reads `pendingAfter`, `priorAttempts` and
   `claimedTags` and does not read the new set, so flume's own loop still
   ships through a misspelled blocker silently — the engine now reports the
   fact and no chain here acts on it. Whether the default handoff should
   refuse, warn, or stay silent is a chain-policy call
   (`.claude/rules/engine-boundary.md`, *Routing rule*), so it is a
   candidate entry rather than something this tick could decide.
   `flume status` is the other plausible reader: an operator staring at a
   stalled queue has no surface naming the tag that resolved to nothing.

2. **Only a `work` or `group` entry can produce one.** `parsePendingQueue`
   already refuses a `step` whose `blockedBy` names no entry in the queue
   (`src/PendingSchema.ts`, the step-scope arm). So the silent-settle case
   this entry closes exists for the other two kinds alone; the test fixture
   says so at its helper.

3. **Two walks over one membership set.** `blockedByGraph` keeps the
   blockers the queue holds, `unresolvedBlockerTags` the ones it does not —
   complements over the same `queued` set, in two loops. Kept apart because
   the first runs only where the chain declared `Chain.order` and the second
   on every selection; folding them would make every selection pay for the
   graph. Not filed as debt, but worth a look if a third reader of that
   membership appears.
