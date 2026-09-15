# A stale line-number cite rides the call-site test's own title

Fixing the fold left the title beside it untouched: a title is a claim other
ticks may have pinned, so retitling is not this entry's call.

`tests/PendingSchema.test.ts` titles the scan "has exactly one production
call site - job.ts's read-only job-listing (PendingSchema.ts:324-329)".
Those lines now hold `adaptStandardSchemaField`, not the loose read: the
declaration sits at `src/PendingSchema.ts:502`, its one call site at
`src/job.ts:590`. A line-number span in a title is narration nothing
resolves - the citation pin reads backticked tokens in comments, never a
title's parenthetical - so it went stale silently and will again. Worth an
entry dropping the span (the symbol names carry it), or a sweep for
`:<line>` spans across `tests/`.

Also checked: no other site in `tests/` compares a `filesUnder` path
against a `"/"`-spelled suffix, so this entry's premise that the shape was
confined to one case holds.
