# Render is the fourth stage-failure class; the quarantine roster is still three

Shipped: `RenderFailure` (`src/tickVerdict.ts`, exported from `src/index.ts`),
`renderFailures` on `TickVerdict`, `TickResult` and `TickOutcome`, from both
producers (the dispatcher's completing verdict and the wave's
ledger-refusal one).

Three things the next tick on this family should know:

1. **The signature rule.** An inline-exec refusal keys on the failing spans'
   *commands*, joined `"; "`; a hook throw keys on `<hook> hook threw:
   <message>`. Deliberately not the stderr and not the frames — both move
   without the wall moving, and a streak that re-keys every tick never
   reaches `abortThreshold`. The stderr rides `message`; the frames stay in
   the prior-attempt record the retry reads. THE-QUARANTINE-ACCOUNTING-TAKES-
   RENDER-AS-A-STAGE's streak test depends on this being stable.

2. **The authoring page still says three stages.** `docs/CHAIN-AUTHORING.md`
   §`quarantineScope` ("a tagged failure at any of the three stages") is true
   as of this commit — render is *reported*, not yet quarantined. It becomes
   wrong the moment `FAILURE_STAGES` gains its fourth member, so that edit
   belongs to the chained entry, not here. Same for the hold-expiry sentence
   beside it: render's expiry is the gate's (a chain fixed on trunk is a new
   render), not provision's.

3. **`consultShouldRun` now answers a shape**, not a string: `{ verdict:
   "run" | "declined" }` or `{ verdict: "refused"; failure }`. Both legs were
   updated; no other caller exists.

Debt observed, not filed: `WaveMergeSetup` holds the leg's `renderFailures`
array by reference and fills it after `openWaveMerge` returns — the same
shape `provisionFailures` already had, so the sweep sees one family rather
than a new one.
