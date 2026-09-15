# Two residues the event-based waits exposed

1. `src/cli.ts` loop startup writes `loop.pid` and acquires the tip claim
   *before* installing the exit/SIGINT/SIGTERM release handlers. A SIGTERM in
   that window takes node's default disposition and leaves both files behind —
   on POSIX, a silent hole in the release-on-signal guarantee
   `tip-claim.integration.test.ts` asserts (stale-reclaimable, so the blast
   radius matches the documented win32 outcome). The fixed sleep hid it; a wait
   keyed on the claim file sits right on the edge, so that case now keys on the
   child tick's banner instead. Fix is ordering: install the handlers before
   taking either lock.

2. The entry's acceptance — no fixed sleep between a spawn and an assertion on
   its effect — is verified by reading, not by a check. A source scan like
   `tests/helpers/spawnBudget.ts` could pin it across both lanes; nothing stops
   the next integration test from reintroducing one.

Whole `pnpm test:integration` now green at 18s (was reding at
loop-process-boundary.integration.test.ts:496). The probe agents' own in-invoke
sleeps stay — they are the window, not a sync point.
