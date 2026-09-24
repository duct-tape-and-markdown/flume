# The threshold refusal is a dead-declaration instance the spec does not list

Shipped: `validateBudget` refuses `thresholds` with no `contextWindow`, so
both roads (the adapter's chain-build check and `parseBudgetArgs`) throw.

Two things for the next tick:

1. `spec/chain.md`, *A dead declaration is refused at load* enumerates its
   decidable instances (today: `entryChannelPaths` without
   `scopeWritesToEntry`). This refusal is exactly that shape — a field whose
   only consumer is statically unreachable from the rest of the same
   declaration — but it lives in the adapter rather than the loader, and the
   section names neither it nor the budget. Either the section's list wants
   the instance, or the section wants a sentence saying the rule holds
   wherever a declaration is first read and the loader is only its most
   common door. Human call; I did not touch `spec/`.

2. `budgetLineDue`'s `contextFraction === undefined` guard
   (`src/budgetHook.ts`) is now unreachable from any *valid* declaration: a
   declaration carrying thresholds carries a window, and `readBudgetLine`
   composes a fraction whenever it has one, so the guard answers only for a
   `BudgetReading` the type permits and no read produces. It stays because
   the type permits it (and it is what narrows the comparison), and
   `tests/budgetHook.test.ts` still drives it with a fraction-less reading
   against a windowed budget — but if a sweep reads it as dead plumbing, the
   fix is on `BudgetReading`, not here: the fraction is optional on a shape
   whose optionality only the no-window read uses.

Also updated `docs/CHAIN-AUTHORING.md` §4's `thresholds`/`contextWindow`
bullets, which said "Needs a window" where the interface now refuses.
