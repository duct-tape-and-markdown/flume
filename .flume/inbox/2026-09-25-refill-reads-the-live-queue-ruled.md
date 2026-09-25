# Ruled: a freed slot reads the live queue, in priority order

Corrects `2026-09-25-wave-bound-and-ledger-per-merge-ruled.md` on the bound.
A refill drawn from the wave's starting snapshot makes every entry filed
after the wave began wait for the whole wave, while the wave works through
lower-ranked entries it happened to start with. Measured on this run: the
per-merge ledger entry, priority 30, filed at minute 40, queued behind the
wave's own priority-0 sweep findings.

`spec/worktrees.md`'s opener now says (this ruling's commit): a freed slot
reads the queue as it stands, in priority order, skips every entry this wave
already attempted, and the wave ends when nothing it has not attempted is
pickable or the run is torn down. The per-merge ledger commit stands and is
what makes a long wave safe. Priority 30: one entry replacing `remaining`
with a live read plus an attempted set, with a case where an entry filed
mid-wave at a higher priority is pulled before a lower one the wave started
with. Fold it into the per-merge ledger entry if that is still queued.
