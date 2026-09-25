# A wave ships at the speed of its slowest tick

Downstream field report, 0.19: a two-minute entry waited on a fifteen-minute
one. Continuing notes help; merging each entry as it finishes would help
more. The ship lock now serializes every merge, which is what a rolling
wave needed and did not have when this repo measured 31% of slot-time idle
on the same shape.

Ruled: the wave merges each entry as its agent finishes, under the ship
lock, and a freed slot pulls the next pickable entry disjoint from
everything in flight, from the tip as it then stands (`spec/worktrees.md`,
the wave section, this ruling's commit). The tick still ends when nothing
is pickable or the budget says to put the wave down. File it.
