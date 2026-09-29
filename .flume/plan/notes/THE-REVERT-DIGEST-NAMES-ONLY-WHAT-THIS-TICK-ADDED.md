# The spec sentence still says "the reverted commit", and afterCommit was narrow too

Two things the next plan tick should see.

1. `spec/loop.md`, *Prior-outcome feedback to the retrying tick* describes the
gate-revert digest as "a `git show --stat` digest of the reverted commit". The
engine now digests the span (`base..head`), which is what makes the absorbed
case honest. For a single-commit span the two readings coincide, so the
sentence is not wrong — it is just narrower than the mechanism. A human edit
to "the span the tick added" would close the gap; I did not touch `spec/`.

2. The afterCommit leg had the same narrowness for a different reason, and it
shipped fixed here as part of following the digest's shape. A tick's span may
carry N commits (spec/loop.md, *The check is ancestry, and N commits are
completion*), and `git show --stat <headSha>` named only the last one — so a
multi-commit reverted tick read back its own final commit as the whole prior
attempt. Now `spanBase..headSha`, one oneline plus stat per commit.

That neighbour is unfixed: `PriorAttemptStore.snapshotReverted`
(`src/priorAttempts.ts`) still snapshots off `sha` alone, so for a
multi-commit span it recovers only the last commit's post-image files. Earlier
commits in the same span are then unrecoverable prose — the exact loss the
snapshot exists to prevent. Out of this entry's scope (its acceptance names
the digest and says the revert's other fields are unchanged), and it is a
listing shape, not a diff, so the fix is `git diff --name-only base head`
plus content read at `head` rather than the span-range read the digest took.
Worth an entry.

Nothing else surprising. `buildGateRevert`'s fourth argument is now a
`{ base, head }` pair in the record's own direction, so the three callers
cannot transpose it, and the git leg it calls now takes the range (renamed
with it; it is not public surface).
