# The candidate rename reached four sites past the entry's cut

Swept the whole family rather than the listed sites. Four beyond
`entry.files`:

- `ShipContext.mergedSha` (`src/Phase.ts`) said "cherry-picked onto trunk" one
  line above the `repoRoot` block this entry corrects — the same interface
  contradicting itself.
- `tests/helpers/external-vocabulary.json` keys the citation pin's exclusion
  by identifier, so renaming `vitestOnTrunk` reds
  `commentCitations.test.ts`'s non-vacuity arm until the key moves with it.
  Worth knowing: an example-chain rename is never local.
- Three `tests/Dispatcher.test.ts` comments claimed a span was judged on
  trunk (`afterMerge gate vetoes any merged trunk`, two non-vacuity blocks).

**Left standing, deliberately.** `GateContext.landedOnSha` and
`BatchGateContext.landedOnSha` are documented as "the trunk tip this span
landed onto". Under a batch that is false for every span after the first: its
pick goes onto the candidate as the previous pick left it, not onto a trunk
tip. But `spec/harness.md` (*What a consumer declares*) and
`spec/chain.md` spell the field the same way, and `docs/CHAIN-AUTHORING.md`
restates it — so correcting `src/` alone would put the hover text at odds
with the human-owned spec. The field's **value** is right (`revParse(tree)`
before each pick); only the word "trunk" in its description is. If this is
worth fixing it is a spec edit first, and the entry would have to carry the
three prose sites together.

Also noted: `docs/CHAIN-AUTHORING.md`'s `repoRoot` row previously told an
author "no field reaches the primary checkout from inside a worktree, so a
gate that needs the trunk belongs at `afterMerge`" — advice that was wrong in
both halves once no stage runs in the primary checkout. Rewritten to point at
`landedOnSha` instead, which is what a gate wanting the trunk as the span
found it actually reads.
