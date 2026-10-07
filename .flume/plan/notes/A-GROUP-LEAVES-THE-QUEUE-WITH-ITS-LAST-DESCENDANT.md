# The walk is in; a partial ship can still orphan a step

`descendantsOf` (`src/PendingSchema.ts`) is the subtree walk, with two callers
in mind: this entry's retirement pass and A-WORK-ENTRYS-FOOTPRINT-IS-ITS-STEPS-TOO.
That entry should read it rather than spell a second descent.

Observed while fixturing the "partial ship" case: the rewrite removes exactly
the tags it was handed, so a shipped set naming a `work` entry but not its
`step` leaves that step with a parent that is gone, and the next strict read
refuses the whole queue (`queueForestErrors`). Nothing in `src/` prevents that
composition today. The group retirement is deliberately not the guard — it
refuses to retire a group over any queued descendant, which keeps the goal
standing over the orphan instead of compounding it, and the fourth test pins
exactly that. The guard belongs where the shipped set is composed:
SHIPPED-RETURNS-THE-TAGS-A-SPAN-SHIPS already states "a partial list leaves
the work entry queued with the steps that remain". Worth checking that entry
lands that rule as a refusal or a hold, not just as a filter — it is the only
thing standing between a partial ship and an unreadable queue.

Two scope calls:

- No Dispatcher-level case. All four `tests[]` lines sit in
  `tests/pendingLedger.test.ts`, where the rewrite decides; a wave-level case
  would re-drive the same pass behind a full tick for no new seam. The ledger
  cases do assert the single sha and `rev-list --count` of 1, so "in the same
  commit" is pinned on a real commit.
- Retired groups are not on `PendingRewriteResult`. The removal is reported
  where the queue is read — the file is gone, the ship commit names it — so
  nothing is held only in memory. If the merge stage's operator line should
  name a retired goal, that is a surface entry of its own.

Also added a paragraph to `docs/CHAIN-AUTHORING.md` §10: a chain author
declaring groups needs to know the engine is the only writer that retires one.
