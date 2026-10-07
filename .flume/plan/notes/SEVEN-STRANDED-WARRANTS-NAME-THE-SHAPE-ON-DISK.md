# Seven stranded warrants, and two the entry did not name

All five sites shipped. Two observations for the next tick.

**An eighth line in the same block.** `src/selection.ts`'s
`PickableSelection.pickable` doc read "neither hold below took" — the same
two-against-three miscount as :404 and :518, three lines under the first of
them, and caught by neither acceptance grep. Fixed here. The grep-shaped
acceptance is what missed it: a count claim has as many spellings as English
does, so a family keyed on literal phrases will keep leaving siblings
standing. If this family files a fourth time, consider asking for the arm as
a pin over hold-count prose against the interface's own field count rather
than another grep list.

**The `order.ts` warrants were load-bearing in a way the entry's framing was
not.** The premise "`blockedBy` carries no cycle check at parse" is refuted —
`blockerCycleFrom` (`src/PendingSchema.ts`) refuses a blocker cycle in the
queue-wide read both parses run — but the guards themselves are not residue:
`goalPlaces`'s seen set is the DAG-sharing guard the walk needs regardless,
and `dependentWork`'s `open` set is the cycle arm alone. Both now state that
they keep the walk total against an invariant another module owns, which is a
declared defensive guard rather than a stale premise. A reader of the old
comment would have concluded the parse admits cycles; a reader who checked
might have deleted the `open` set as dead plumbing. Worth noting that
"narration a reshape stranded" and "dead plumbing" can point at the same site
with opposite fixes — the sweep's cite decides which, and here the warrant was
wrong while the code was right.
