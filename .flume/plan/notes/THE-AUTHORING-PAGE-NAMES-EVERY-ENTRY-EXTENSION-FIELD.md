# The page could not have named contractTouching until the surface walk saw a const's literal

Naming `contractTouching` in the authoring page's roster red the page-identifier
pin (`tests/pageAnchors.test.ts:533`): `packageSurface` (`tests/helpers/exportGraph.ts`)
collected a string literal only from a literal *type* node, and the emit for
`export const CONTRACT_TOUCHING_FIELD = "contractTouching"` is an initializer
(`export declare const CONTRACT_TOUCHING_FIELD = "contractTouching";`), not an
annotation. So no shipped page could roster any key the package spells as a
const — the field's own key was unnameable on the surface that declares it.

Widened the walk to a string literal whose parent is a variable declaration,
and pinned it positively at the one caller. Measured, not guessed: the arm was
added because this entry's page edit reproduced the drift.

Two adjacent facts for the next rotation, not filed:

1. The roster arm reads the parenthetical after "the entry extension (" inside
   the harness-package bullet, and compares the closed set both ways (a `[]`
   suffix folds out, so `tests[]` matches `tests`). Any future field the
   package adds reds it; so does a field retired off the declaration but left
   on the page. The anchor is that phrase — a reword of it reds at the
   vacuity pin, naming the roster.
2. `contractTouching` is now named on a shipped page but explained on none.
   The hint is its home for what it means and restating that on the page would
   be a second copy (`.claude/rules/engineering.md`, *Derived state is
   computed*), so nothing was added. If a consumer-facing explanation is
   wanted, it needs a section of its own, not a gloss in an inventory bullet.
