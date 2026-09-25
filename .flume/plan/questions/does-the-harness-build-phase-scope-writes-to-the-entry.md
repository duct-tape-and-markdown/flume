# Does the harness's build phase scope writes to the assigned entry?

A downstream 0.19 report (item 15) puts numbers on the cost of leaving it off.
Of ten real merge conflicts in their runs, **three were on files outside the
shipping entry's `files`**, and a fourth was declared by one writer and not the
other — so the fanout partition could not serialize any of the four. The
partition's disjointness key is only as good as the prediction it reads, and an
undeclared shared write is invisible to it.

`Phase.scopeWritesToEntry` already exists and is `false` by default
(`spec/pending.md`, *The entry-scoped write guard is opt-in, and off by
default*). The harness wires the pairing when a consumer turns it on:
`harness/chain.ts:348` adds `entryChannelPaths` off `declaration.channelPaths`
whenever `declaration.scopeWritesToEntry` is set. This repo declares `false`
(`.flume/declaration.ts:61`).

## The fork

**(a) Turn it on in the harness's build phase.** Undeclared writes are refused
at the fence instead of colliding at the merge, so the four conflicts above
become four parks. Cost: the spec section above already records the measured
downside from this repo's own trial — "every park that fence produced was a
mispredicted path rather than a refusal of the work — plan cannot know which
files a move breaks without doing the move" — plus the width cost it measures,
mean first-batch width falling from 3.17 to 1.99 at `maxParallel: 4` once one
shared path entered substantially every entry.

**(b) Leave it off and document the pairing.** `docs/CHAIN-AUTHORING.md:524`
and `:525` describe both fields, but nothing tells a consumer that a phase
which legitimately writes shared files wants `scopeWritesToEntry` paired with
`entryChannelPaths` — which is the shape that makes (a) survivable. Cost: the
consumer's four conflicts stay conflicts until they find the pairing
themselves.

**(c) Neither — the defect is upstream of the knob.** The spec section argues
that pushing the allowance into `files` overloads one field with opposed
pressures: the partition wants a narrow honest prediction, a permission wants a
wide defensive one. If that argument holds, the consumer's three undeclared
shared writes are evidence that **the partition needs a second input** — a
per-phase declaration of the shared files every entry may touch — rather than
that the entry's `files` should become a fence.

## Why this is the human's

(a) changes what the package's own build phase refuses, for every consumer that
adopts it, against a measured trade this repo already took once and reversed.
The reporter routed it here for that reason rather than filing an entry. (b) is
shippable the moment (a) is declined; (c) is a spec change and would be filed
against `spec/pending.md` after a ruling.
