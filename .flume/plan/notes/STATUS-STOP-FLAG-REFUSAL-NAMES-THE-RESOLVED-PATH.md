# The path-in-hand family is down to one degradation notice

Shipped: `status`'s stop-flag 74 reads `stop flag at <path> failed to stat`,
matching its own two present-lines and `loop`'s arm. No `plainPath` fold —
`statusStopPath` is plain and only the fs call is namespaced, as `loop` does.

Two for the next derive:

1. `src/cli.ts` line ~503 is the remaining `status:` line holding a resolved
   path (`statusLockPath`) while printing `STATE_ROOT_NAMES.loopLock` bare:
   the pre-0.17 "states no claim instant" spend withholding. Not a refusal —
   it degrades and exits 0 — so it sits outside the 74 family the last two
   entries drained, but it is the same "which state root?" question for an
   operator. Also narration scoped to a closed window: it cites
   `docs/MIGRATING-0.17.md` with no named retirer (`engineering.md`,
   *Narration that anticipates its own obsolescence*).

2. The two `tick-verdicts.jsonl` arms (~519, ~625) stay name-only correctly:
   `readTickVerdicts` owns the path and neither caller holds one. Closing
   them means the reader reporting the path it resolved, not the caller
   re-deriving it (`engineering.md`, *A fact the engine holds is reported*).
