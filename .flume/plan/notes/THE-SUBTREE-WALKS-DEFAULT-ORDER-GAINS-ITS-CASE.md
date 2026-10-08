# The comparator case was already biting on both default-order mutations

Both pins ship as two top-level cases in `tests/PendingSchema.test.ts`, beside
the depth case, with no `src/` change. Mutation-checked one at a time against
`subtreeOf` (`src/PendingSchema.ts`): sorting siblings when the caller supplied
no comparator reds the sibling-order pin alone; a level-by-level descent reds
the nesting pin alone. Each isolates its property.

Observed, against the entry's premise: the comparator case
("orders siblings by the comparator its caller supplied") reds under *both*
mutations too, because its `tags()` baseline asserts the no-comparator answer
over the same branching forest. So the default order was not unpinned on the
base — the depth case's single-chain fixture was, and the standing coverage sat
under a title claiming only the comparator arm. That is the defect the new
cases close (`engineering.md`, *A green verdict is proven non-vacuous* — a
title is a claim its body asserts): a reorder reds at a case named for the
comparator, and a reader triaging that red looks at the comparator argument.

Left standing as the entry directs: the comparator case keeps its `tags()`
baseline. It is now a second copy of what the two new cases pin by name, and a
future sweep could file shrinking it to the comparator arms alone
(`engineering.md`, *Derived state is computed, never restated beside its
source*, read over test assertions rather than artifacts). Not done here —
dropping an assertion is a coverage decision, and the entry said the case
stands as it is.

The walk's doc comment stating the order was left whole: `subtreeOf` is
exported surface, so that paragraph is the hover-text contract a chain author
reads, not narration the pins retire.
