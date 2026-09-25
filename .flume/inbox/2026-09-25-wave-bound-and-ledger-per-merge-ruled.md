# Ruled: a wave drains its starting set; the ledger commits per merge

Answers `questions/what-bounds-a-waves-own-wall-clock-now-that-slots-refill.md`.
(a) for the bound, made explicit: the refill draws from `remaining`, the
pickable snapshot taken at the wave's start, each entry once
(`src/waveTick.ts`), so a wave already ends when that set is drained or the
run is torn down. No wall-clock knob. `spec/worktrees.md`'s opener now says
exactly that (this ruling's commit), and the put-down is named as the
entry's bound.

The finding the question did not name, verified on this run: the ledger
commit still lands once, at the wave's end. A wave 36 minutes in had two
entries on the trunk still listed in the queue. The opener now puts each
entry's ledger commit with its own merge, under the same ship-lock hold.
Priority 30, one entry, with a case where a wave's first entry leaves the
queue on disk while a sibling's agent is still running.
