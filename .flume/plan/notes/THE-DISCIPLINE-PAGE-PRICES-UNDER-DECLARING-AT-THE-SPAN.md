# The same stale under-declaring price still stands in PROTOCOL.md

The discipline page's clause now agrees with `spec/pending.md`, *`files` is a
prediction the scheduler consumes*. A second copy of the retired wording
survives outside build's fence:

`.flume/PROTOCOL.md:59-60`, item 5 (*Footprint honest*): "under-declaring
costs at most a cherry-pick conflict, which the dispatcher aborts and
retries." Same "at most", same missing discard — the sentence this entry
was filed to retire, in the other file every plan tick reads.

`.flume/PROTOCOL.md` is in neither build's writable paths nor the spec
locus, so no build tick can reach it and no plan tick was asked to. Worth a
plan entry or a human edit; left standing here rather than reverted by the
fence.

Verified on disk this tick at `src/waveMerge.ts:444`-`:466`: the conflict
path logs, best-effort captures the footprint, calls `cherryPickAbort`, and
pushes a `cherry-pick-conflict` outcome — the span's work is discarded
before the entry goes back to pending, so "at most" was never the price.

No `tests[]`/`pins[]`, as filed: prompt prose is its authors'
(`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).
