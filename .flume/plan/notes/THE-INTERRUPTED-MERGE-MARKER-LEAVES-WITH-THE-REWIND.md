# The marker's leftovers were citations, not spec

The entry's note predicted a `spec/harness.md` leftover naming a merging
stake. There is none: the only state-root list on that page
(*Presence is state, location is kind*) names `awake/`, the stop flag, the
lock, the tip claim and a prior-attempt record — never the merging dir. No
`spec/*.md` sentence names it either. Nothing for a question.

What the retirement actually dragged along, all re-homed in this commit:

- Five doc comments cited `readMergingMarkers` as the second reader of the
  `isDirectoryOrAbsentUnder` descent (`pendingLedger`, `entryClaims`,
  `priorAttempts`, `harness/dirListing`, `tests/fsProbe`) and one in
  `tests/helpers/denial.ts` cited the Dispatcher case that sealed a state
  root above it. Each now names `renderedPromptNames` or
  `PriorAttemptStore.readAll` — real siblings running the same descent. The
  citation pin reads the token, so these would have red'd; worth knowing
  that retiring a module in this tree costs a sweep of its *prose* consumers
  as much as its callers.
- Two `wave-walled` cases used an obstructed `merging/<slug>.json` path as
  the only wall in the merge stage that is not a refused ledger rewrite.
  Their replacement wall is a red `afterMerge` gate for one entry with that
  entry's prior-attempt record path obstructed — the gate-revert record write
  throws inside the same ship-lock hold. Same shape (engine-spelled path,
  structural denial), but it is now the *only* non-ledger wall the suite can
  reach in that stage, and it needs a red gate to arm. If a future entry
  moves the gate-revert record write, both cases lose their arming at once.

Dropped with the module: the three `readMergingMarkers` absent-vs-unreachable
cases, both merge-stage marker cases, the `merging/` arm of
`flume loop`'s start-up 74 (now two arms), and the `merging/` ignore line.
`docs/MIGRATING-0.15.md` still documents the marker — left standing as the
dated record of that port.
