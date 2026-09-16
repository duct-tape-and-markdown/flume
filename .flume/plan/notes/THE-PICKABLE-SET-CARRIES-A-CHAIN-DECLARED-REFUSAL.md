# The capability ships; the harness is not yet its declarer

`Chain.refusesEntry` exists and the engine enforces it on every pickable set
it reports, naming what it held back on `TickResult.refusedTags`.

The second half of the cited section is still unshipped: the harness declares
no `refusesEntry`, so this repo's chain still re-dispatches an entry whose
latest prior attempt was a clean exit at the current HEAD — at full agent
price. The predicate is two lines against the context the engine now hands it
(`docs/CHAIN-AUTHORING.md` section 12 shows it verbatim), but it is policy,
and this entry was scoped to the capability. Wants an entry of its own.

Observed while wiring it: `harness/inboxWindow.ts` re-spells the engine's
record-key composition by hand (`record.key === "entry"` plus a `slugify` of
each queued tag). It filters rather than looks up, so `entryAttemptKey`
(`src/priorAttempts.ts`) is not a drop-in — but the keying rule now has an
engine-side home, and the copy is worth a look under consumer restatement.
