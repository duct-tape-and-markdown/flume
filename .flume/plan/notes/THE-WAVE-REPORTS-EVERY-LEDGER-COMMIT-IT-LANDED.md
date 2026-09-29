# The ledger set is on TickResult; the verdict and spec/chain.md still say one

Landed: `WaveMerge.chorSha` is now `ledgerShas: string[]` (appended per pick,
`src/waveMerge.ts`), `TickResult.ledgerCommitShas` reports the set and
`commitSha` is computed as its last element at `src/waveTick.ts`, under a
hover that names which commit it is per concurrency. `docs/CHAIN-AUTHORING.md`
("handoff reads the TickResult") names the new field beside it.

Two things for plan, neither in this entry's scope:

1. `spec/chain.md`, *What a hook receives* enumerates each field TickResult
   adds beyond "the existing facts", and `ledgerCommitShas` is not among them.
   Build cannot edit `spec/`, so the page and `src/Phase.ts` now disagree by
   one line — a human-directed spec edit, not a defect I could close.

2. The **tick verdict** still carries no ledger set. `TickVerdict` records
   each pick's cherry-pick range on `mergeOutcomes`, but the ledger commit a
   pick landed appears nowhere on disk — only in memory, and now on the
   handoff. Same section as this entry's `per`
   (`.claude/rules/engineering.md`, *A fact the engine holds is reported,
   never rediscovered*), different surface: the verdict artifact rather than
   the handoff object. An operator reading `verdict.json` after the fact
   cannot name the commits that retired the queue. Worth an entry if the
   surface matters; the acceptance here was scoped to the handoff alone.

No debt observed in the wave-merge fold otherwise: the stage held exactly one
field for this fact, so the widening was local and `closeWaveMerge` passes the
set through without a second copy.
