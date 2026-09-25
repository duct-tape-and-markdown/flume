# The record leg's checkout side still throws out of promptArgs

Shipped: the wake's tip listing is re-made in the render and refuses as the
shared `REFUSE:` block (`windowRefusal`, `harness/sliceWindow.ts`), so the
fail-open arm at `recordsPending` is bounded again.

What I verified this tick and did not fix, because the entry's arm did not
claim it: the **checkout** side of the same leg still throws uncaught out of
`promptArgs`. `renderRecords` (`harness/inboxWindow.ts`) calls
`recordFiles(checkoutRecords(...))`, which refuses on an obstructed record
directory — pinned at `tests/harnessRecords.test.ts:182`, "recordFiles
refuses when a plain file sits above a record directory" — and `renderFiles`
reads each record with a bare `readFileSync`. Either throw kills the inbox
tick before any agent runs, with no verdict and nothing said; the next wake
opens over the same disk. That is exactly the failure mode `cursorWindow.ts`'s
`bounded` exists for, and it now has a second home to reach
(`windowRefusal`) — a `bounded`-shaped wrapper over the whole records leg is
a few lines. The friction and lane legs render beside it and I did not read
them for the same shape.

Two notes on the shape I chose, in case plan wants them elsewhere:

- `listRecords` (`harness/records.ts`) returns an **anonymous** union rather
  than a named exported type on purpose: a named `RecordListing` would be an
  export the `exports` map cannot reach and no module outside `records.ts`
  names, i.e. residue by `exportConsumers.test.ts`. If a consumer ever wants
  the shape, index it and name it together.
- The refusal renders *instead of* the checkout's records and the friction
  notes, not beside them. A tick shown files to route under a block saying the
  queue could not be listed would be acting on a failed listing. Cost: a
  friction note waits while git is broken. Stated at the site.
