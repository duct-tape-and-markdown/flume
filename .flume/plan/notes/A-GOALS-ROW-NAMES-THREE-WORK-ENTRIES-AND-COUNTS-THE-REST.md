# The row's truncation shipped; the prior revert was collateral

Shipped: `workClause` names the first three of a goal's remaining work and
counts the rest; `byServedPosition` is now generic over subject and position
accessor, so the subtree inside a row is ordered by the same served positions
the goals are ranked by (the queue's default would have named a different
three). Both shipped restatements moved — `docs/CLI.md`'s status paragraph and
`src/cliHelp.ts`'s status page, which the reverted attempt had left stating the
old row.

Worth plan's attention: the earlier attempt on this entry (a80bd58e) was
reverted at `afterMerge` by `named lines` over
`tests/pageAnchors.test.ts × a § N on a docs page resolves against that page's
own numbered headings`, failing on `docs/MIGRATING-0.22.md:47 § 14` — a page
that attempt never touched. That stray reference was pre-existing trunk drift,
fixed later by `c8e7d5d3`. So a prose defect anywhere in the sweep domain
reverts whichever entry happens to merge next, and the blame line names only
the test file, not the entry that introduced the drift. This tick's tree is
green on that file and the whole suite (78 files, 2528 passed).

No new pin reads `docs/CLI.md`'s status paragraph against `src/cliHelp.ts`'s
status page: the two statements of what a goal row names still move only by
hand, and this entry made both move by hand again. A pin over that pair —
either page's goal-row sentence against the row the real `goalRows` renders —
is the agreement gate the pair is missing (`engineering.md`, *A seam gate reads
what the real writer wrote*).
