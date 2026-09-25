# Ruled: a lane read is refused by the run's own commit, not its instant

Answers `questions/is-a-lane-read-refused-by-the-runs-own-sha-rather-than-its-instant.md`.
(A). The run's commit is the forge's own statement of the tree it judged;
the instant was the reader reconstructing it (`engine-boundary.md`, *Told,
not inferred*). (B) re-attributes a parent's red to the child, the hole the
section closes. `spec/harness.md`, *CI lanes as a findings source* now says
it in three places, all in this ruling's commit: the block states the run's
commit instead of its created instant, a run whose commit is not the tip
reads `UNREAD` naming both commits, and a lane makes the slice live only
when its latest completed run is the tip's own, so a stale red wakes
nothing it would then refuse.

Cost, stated: while the loop ships faster than CI finishes, most lane reads
are `UNREAD`. A red that persists reports on the tip's own run once the loop
quiets. One entry: the swap in the lane reader and the wake predicate; the
instant read and its offset parse leave with it.
