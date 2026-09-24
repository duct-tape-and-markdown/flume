# Does PROTOCOL restate the under-declaring price, or point at it?

**Section:** `spec/pending.md`, *`files` is a prediction the scheduler
consumes* — ":164", the ruling that under-declaring costs the tick's span:
the dispatcher "aborts, discards the work already done before it leaves the
entry pending, and the retry" re-earns that span at a fresh agent.

`harness/prompts/plan-discipline.md` was corrected to agree with that
sentence (shipped `THE-DISCIPLINE-PAGE-PRICES-UNDER-DECLARING-AT-THE-SPAN`).
A second copy of the retired wording survives:

`.flume/PROTOCOL.md:59`-`:60`, item 5 (*Footprint honest*) — "under-declaring
costs at most a cherry-pick conflict, which the dispatcher aborts and
retries." Same "at most", same missing discard.

## Why no phase can fix it

`.flume/PROTOCOL.md` is in neither build's fence (`.flume/declaration.ts`,
`fence.build`) nor the spec locus (`spec/**`, `.claude/rules/**`), and no
plan slice's writable paths reach it either. So it is reachable only from an
interactive session under human direction — hence a question rather than an
entry.

Verified on disk this drain at `src/waveMerge.ts:444`-`:466`: the conflict
path logs, best-effort captures the footprint, calls `cherryPickAbort`, and
pushes a `cherry-pick-conflict` outcome. The span's work is discarded before
the entry goes back to pending, so "at most" was never the price.

## The fork

1. **Correct the wording in place.** Item 5 states the discard the way the
   spec section does. Cheapest, and leaves a third copy of one fact standing
   — a page every plan tick reads, kept in agreement with the spec by
   discipline alone, which is the mechanism that just failed once.
2. **Shrink item 5 to a pointer** — "Footprint honest. `files` names what the
   work will touch; the price of each direction is `spec/pending.md`,
   *`files` is a prediction the scheduler consumes*." The restatement is what
   let it drift (`.claude/rules/engineering.md`, *Derived state is computed,
   never restated beside its source*), and the discipline page the plan
   slices actually read already carries the full price. **Recommended.**
3. **Both, plus a home that a phase can reach.** As 2, and additionally rule
   on whether `.flume/PROTOCOL.md` should be inside some fence at all — today
   it is the one prose surface every tick reads and no tick can correct, so
   every drift in it costs a human edit. Costs a fence decision nobody has
   asked for; named here only because it is the structural cause.

## Also for the ruling

If 2, the two page names item 5 would then cite resolve under the standing
citation pin only from a tree the sweep domain names — `.flume/PROTOCOL.md`
is named by the *Expired narration* lens in `.claude/rules/posture-sweep.md`
but is not in `commentCitations`' scanned set. Worth deciding whether that
page's cites should resolve mechanically, or stay the human's to keep.
