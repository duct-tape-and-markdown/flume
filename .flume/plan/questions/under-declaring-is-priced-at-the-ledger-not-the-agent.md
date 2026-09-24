# `spec/pending.md` prices under-declaring at the ledger and is silent on the agent

`spec/pending.md`, *`files` is a prediction the scheduler consumes*, closes on
the cost of a mis-prediction:

> Over-declaring costs wave width, because the partition treats a shared path
> as a collision; under-declaring costs at most a cherry-pick conflict, which
> the dispatcher aborts and leaves pending for a retry.

Note SIBLINGS-OF-ONE-SECTION-DECLARE-THE-SEAM-THEY-SHARE reports that half of
this is true of the ledger and silent about the agent. Spec is the human's
surface, so this is a proposed edit, not something plan can make.

## The gap

"Aborts and leaves pending for a retry" describes what happens to the *entry*:
nothing is lost, it comes back round. What it omits is what happens to the
*work already done*: the aborted commit's span is discarded, and the retry
re-earns it at full agent price. The entry survives; the tick does not.

That is the cost that makes an under-declaration worth filing against, and it
is the sentence a derive tick reasons from when it decides how carefully to
predict `files`. As written, the section reads as "over-declaring is the
expensive mistake, under-declaring is cheap" — which inverts the real prices
whenever a span is non-trivial.

`harness/prompts/plan-discipline.md` already states it correctly in its
sibling-seam paragraph ("the retry above prices that at a fresh agent, not a
fresh partition"), so the prompt and the spec now disagree about the same
mechanic. The prompt is the copy a plan tick reads; the spec is the copy
everything else derives from.

## Evidence

Both measured cases on 2026-09-24 were under-declarations. The note does not
claim a rate beyond those two, and I did not re-measure.

## Options

1. **Amend the sentence** to name both costs — something like: "under-declaring
   costs the tick's span, which the dispatcher discards before leaving the
   entry pending for a retry to re-earn." Smallest edit; makes the two prices
   comparable in the one place they are stated together.
2. **Amend and cross-reference** — as above, plus a pointer to where the retry
   is specified, so the reader can price the re-earn themselves.
3. **Leave it.** The prompt states it, and the prompt is what a plan tick
   reads. Costs: the two copies stay in disagreement, and any future reader
   deriving from spec alone gets the wrong ordering.

## What I would do

Option 1. It is one sentence, it removes a disagreement between two live
copies, and the corrected ordering is the one both measured cases support.
I would avoid wording that implies a *rate* ("usually", "often") — two cases
do not support one, and the point is the price, not the frequency.
