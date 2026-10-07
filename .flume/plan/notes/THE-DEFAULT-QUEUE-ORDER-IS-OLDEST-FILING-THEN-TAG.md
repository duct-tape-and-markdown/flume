# The filing read is a git log per selection, and seconds are its resolution

**Cost.** `readLedgerFilingTimes` shells one `git log --diff-filter=A` over the
ledger directory per selection — a wave pays one at open, one per refill, one
post-wave. Measured on this repo (3933 commits, 365 tags ever filed): 0.33s
cold, ~50ms warm. If it shows up, the fix is a per-tick cache keyed on the tip
the read was taken at, not a narrower walk.

**Ties are the normal case here.** git stamps a commit time in whole seconds,
so every entry one plan commit files shares a filing time and falls through to
the tag. Of the six entries standing at this tick, five share one second. So
the filing axis separates *waves* of filings, not entries inside one — which is
what the spec sentence wants, but worth knowing before a later entry reads
these times as a per-entry clock (the flow figures: median filing→shipping).

**A platform fact is living in a code comment.** git's rename detection is on
by default and is host config, so a renamed file carries no add and the same
history would answer two hosts differently; `addedPathTimes` (`src/git.ts`)
passes `--no-renames` and states that at the site. By the ladder that belongs
on `platform-facts.md`, which only a human writes — flagging rather than
filing.

**Not reported yet.** The times change what dispatch does and ride no
reporting surface (`engineering.md`, *A fact the engine holds is reported,
never rediscovered*). The two homes are already queued —
CHAIN-ORDER-IS-THE-QUEUES-SEQUENCING-POLICY's `OrderContext` and
STATUS-REPORTS-THE-QUEUES-FLOW — so no entry filed for it.

**One test retitled.** "a wave pulls an entry filed mid-wave ahead of one it
started with" is now "…that its opening selection never held": a mid-wave
filing is the newest, so it is served last, and that case's old green was a
same-second tie. It now dates its filing commits, through
`commitEntryFiles`, which is `commitEntryFile`'s dated multi-file form.
