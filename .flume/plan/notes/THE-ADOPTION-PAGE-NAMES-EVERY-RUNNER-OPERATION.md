# The operation list is pinned; the count word beside it is not

The pin equates the bullets under *What adoption costs* with `Runner`'s
declared members, both directions. What it deliberately does not read is the
same section's count word — "the work is not the three signatures", "a
working implementation of all three" — and the sibling sentence in
*"Declaration" names two different things*: "over the same three operations".
Each is a copy of the member count that a fourth operation would strand, in
prose that still reads as current.

Left unpinned because the only check available is `toContain` over a phrasing
("all three"), which reds on an innocent rewrite rather than on the fact
changing — a false red, not a defence. The fix is upstream: prose that names
the operations instead of counting them has nothing to go stale, and this pin
then covers it. That is a docs edit with a judgment call in it (does the page
lose something by not pricing "three"?), so it is plan's.
