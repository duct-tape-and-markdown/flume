# The ruling took (b); fork (c) now lives nowhere

Landed: `docs/CHAIN-AUTHORING.md` §1, immediately under the phase table's
`entryChannelPaths` / `scopeWritesToEntry` rows — the pairing, then both
measured sides (the 0.19 reporter's three-of-ten conflicts on undeclared
paths; this repo's 3.17 -> 1.99 first-batch width at `maxParallel: 4`), then
what distinguishes the two cases for a consumer weighing it.

Two things the next plan tick may want:

1. The closed question offered a third fork: that the consumer's undeclared
   shared writes are evidence the *partition* needs a second input — a
   per-phase declaration of shared files every entry may touch — rather than
   that `entry.files` should become a fence. The operator ruled (b), which
   answers the docs gap and leaves (c) unrecorded anywhere on disk now that
   the question file is drained. If it is meant to stay live it needs a
   question of its own; if it was declined with (b), nothing to do.

2. `docs/CHAIN-AUTHORING.md:305` (the sidecar-fence recipe) reaches for
   `scopeWritesToEntry` with one line — "per-*entry* narrowing is already a
   declared field" — and does not mention the channel. I left it alone rather
   than widen the entry's footprint, but a reader who lands there first still
   meets the flag without its pair. A one-clause pointer at the new §1 prose
   would close it.

No test or pin: the figures are measurements from a report and a prior trial,
not a property the suite can hold. `tests/docSections.test.ts` and
`tests/commentCitations.test.ts` both green over the new prose.
