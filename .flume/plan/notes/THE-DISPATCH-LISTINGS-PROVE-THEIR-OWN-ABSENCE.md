# The absence-proof family is not closed by these two listings

Shipped: both listings descend. The descent composer is now one function —
`isDirectoryOrAbsentUnder` (`src/fsProbe.ts`) — and `listUnderStateRoot`
(`harness/dirListing.ts`) adopted it in the same commit, so the rungs between
a root and a leaf are spelled once rather than at each reader.

`flumeDir` moved up from `TickLegContext` into `PendingLedgerContext`: the
ledger's disk read needs the root it descends from, and the leg context
already carried it. No new field on the dispatcher — `ledgerCtx` passes what
it held.

Three things the next plan tick may want:

1. `frictionNotes` (`src/friction.ts:95`) is the same shape, unfiled: a
   listing keyed on `ENOENT` over a chain-declared dir joined onto a state
   root or a worktree mirror. Its absence decides what a prompt renders and
   what `flume friction` prints, not dispatch, so it is a rung below the two
   this entry took — but it is the third listing in the family and the fix is
   now two lines.
2. The file-reading arms key absence on `ENOENT` too, and on win32 an
   obstructed ancestor is `ENOENT`: `src/Baton.ts:100` (absent flag =
   hibernate), `harness/planState.ts:310` (absent state = re-derive),
   `harness/prompts.ts:594`, `src/pidClaim.ts:120`. Whether each is
   correctness-adjacent is a triage call, not a mechanical one — a baton that
   reads unreachable as asleep is louder than a prompt that renders nothing.
3. `join(commonDir, "flume", …)` is spelled three times —
   `src/entryClaims.ts:45`, `src/git.ts:776`, `src/git.ts:810` — so the
   git-dir-side flume directory has no home, and `readHolders`'s descent now
   walks a rung nothing names. Cohesion debt (`engineering.md`, *A module is
   one job*), not correctness: a fourth consumer spelling it is when it bites.
