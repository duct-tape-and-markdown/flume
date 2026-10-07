# The order cases order over the engine's context now; two notes beside it

Landed in `tests/harnessOrder.test.ts`: each case files its queue into a
real repo (entry files, dated commits), reads it back through
`readPendingForDecision`, and takes `pickableSelection` with the package's
`queueOrder` as the chain's order. `handed.queue`/`handed.filedAt` are
asserted by identity against what the engine read. Mutation-checked:
dropping the settled-blocker filter in `blockedByGraph` reds the new pin;
an empty graph reds three cases.

1. `tests/helpers/repoChain.ts` was not touched, against the entry's
   prediction. Its `orderSrc` is for a chain source a CLI subprocess loads,
   and `Chain.order`'s own doc says a test may drive the hook without a
   tick — so no process boundary was needed and the fixture lives in the
   suite. If a later entry wants the order end-to-end through a real verb,
   note that no verb prints the served sequence; `flume status`'s goal rows
   are the only window, which is what `tests/cli.test.ts` already uses.

2. The queue parse is strict, so the provenance fields the "where an entry
   came from never orders it" case uses (`priority`, `source`) can only
   reach a queue through a *consumer* entry extension — the suite declares
   one beside the package's. Worth seeing as a fact: a producer's urgency
   field is already refused a rung above the order hook, by the package's
   own extension, for every consumer that does not declare one. The case's
   old "ready set reversed" leg is gone with the in-memory context: the
   engine hands the hook the ready set in its own default order, so queue
   order is no longer a fixture's to spell.

Cost: the suite now spawns git — 9 scratch repos, ~1.1s in the default
lane, under its declared `SPAWN_BUDGET_MS`.
