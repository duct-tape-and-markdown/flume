# The unreachable-record family now has two halves with opposite loudness

Landed: `read` accepts only when `priorAttemptPath(flumeDir, refOfRecord(rec))`
is the path it read from, asked of the path rule (`src/priorAttempts.ts`, the
accept arm). Absent, like its keyspace sibling — no throw, no deletion.

Observed, and plan's to rule on:

1. Two checks now ask one question of one rule from opposite sides. The walk
   (`readAll`) asks it of the **stem it found** and **throws**; `read` asks it
   of the **identity the record states** and degrades to **absent**. Both
   describe the same file class: one no `read`, `clear` or retry reaches. So a
   hand-renamed file (stem rewritten) names itself loudly to an operator,
   while a hand-edited one (`keyedAs` rewritten) is now silent everywhere —
   `readAll` skips it, `clearStale` no longer names it, nothing logs it. The
   acceptance asked for silence and I shipped that; whether the family wants
   one verdict is a decision I did not make. If it does, the loud arm is the
   one the walk already has, and it is the surface that can see the file.

2. `clearStale`'s report and its removal are both composed from
   `refOfRecord`, so after this change a reported key is a file that left and
   a file left standing is a key unreported. Pinned by the third `tests[]`
   line, which also holds the sweep's live half (a real record cleared in the
   same call) so the assertion is not green over a sweep that clears nothing.

3. No `write` path can trip either check — every stem and identity it composes
   is that rule's own output. Both arms are reachable only from a rename or a
   hand edit, which is why both cases are hand-authored fixtures (the
   sanctioned exception under *A seam gate reads what the real writer wrote*).

Nothing else in the tree asks this round trip: `recordAttemptKey`,
`phaseAttemptKey` and `entryAttemptKey` compose keys freely, but only records
`read` accepted reach them.
