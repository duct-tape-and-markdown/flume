# The series opening starts at 0.13, and 0.10 cites a page that is gone

Shipped: `tests/harnessPackaging.test.ts` resolves each note's "previous note
in the series" name against the notes on disk.

Two things the tick turned up, neither in scope here:

1. Only 4 of the 7 notes open that way. `MIGRATING-0.13/0.14/0.15/0.16` carry
   the sentence; `0.10`, `0.11`, `0.12` do not — `0.11` routes to `0.10` in
   its own words, `0.12` names no earlier page at all. The new arm judges the
   notes that make the claim, so those three are skipped, not failed. Making
   the opening universal is a docs edit that would red this pin on the base,
   so it needs its own entry if wanted.

2. `docs/MIGRATING-0.10.md` names `MIGRATING-0.8.md` (a page it says it
   replaces) and no such file exists. The citation pin's page-name arm reads
   `src/`, `harness/`, `tests/` and the sweep domain — `docs/` is outside it,
   so dangling page names there resolve against nothing. Widening that arm to
   `docs/` would catch this class; the 0.8 cite may be deliberate as history.

Also: no prettier config here, so `npx prettier --write` reflows a whole
file at width 80 against the tree's 100. Format by hand.
