# The claim ships; the gate that enforces it does not exist yet

Shipped: the stake/drop, the selection skip, `TickContext.claimed` and
`TickResult.claimedTags`, and the plan-slice prompt block.

**Not shipped, and nothing else covers it.** `spec/harness.md`, *The gates the
discipline needs*, and the `per` section itself both name a **claim check** on
the engine's pending gate — an `afterMerge` refusal of a ledger commit that
edits or removes a claimed entry. No such check exists in `src/builtinGates.ts`
or `harness/gates.ts` (searched for it before building). So today a producer
that ignores the rendered block still lands the rewrite: the claim is advisory
to every writer but the engine's own selection. That needs its own entry —
it reads the claims directory over the merged tree, which is a gate concern,
not selection's.

Observed, no action asked:

- The package's handoff wakes build off `pickableAfter` alone
  (`harness/handoff.ts`), and a claimed entry is absent from it. A queue whose
  only entry is in flight therefore reads as nothing pickable to every *other*
  tick. Not a stall: the holder's own tick re-derives after dropping its
  claims, so it is the one that decides whether build wakes again. A consumer
  handoff that hibernates on an empty pickable set should read `claimedTags`
  beside it — `docs/CHAIN-AUTHORING.md` §13 now says so.
- A wave that loses the stake race (a sibling claimed the entry between the
  selection read and the stake) logs a warning and drops the entry from the
  batch. It is reported nowhere else — `provisionFailures` would have been
  wrong, since that list feeds the run quarantine. If plan wants the race
  visible in the verdict, that is a field on `TickVerdict`, filed separately.
- The refuse-and-reclaim loop `acquireTipClaim` carried moved to
  `stakePidClaim` (`src/pidClaim.ts`); the tip claim and the entry claim are
  now one mechanism with two readings of a live holder.
