# The armed-domain listing is unbudgeted, as the bootstrap listing is

`armedDomain` (`harness/sweepWindow.ts`) renders one line per tracked
domain file whenever the range touched a posture page — 108 lines on this
repo today, and unbounded in a consumer whose declared domain is larger.
It is deliberately outside the `budgetOf` cut the retired-claim block
takes: the budget there is spent on diff text, and a path listing is a
different unit. `bootstrap` (`harness/cursorWindow.ts`) has had exactly
this property since it shipped, so a consumer with a huge corpus already
pays it on its first derive tick and on every sweep bootstrap.

That makes two unbudgeted whole-corpus listings with one call behind them
(`filesMatching`, `harness/gitRange.ts`). If a consumer ever reports a
window too wide to read, the fix is one bound at that call rather than two
— worth a single entry then, not two. No drift measured here, so this is
an observation, not a filing.

Second, smaller: `frontierListing` now takes `cwd` and reads the tree,
which it did not before — its failures reach the prompt through
`cursorWindow`'s `bounded`, the same leg `retiredLines` already used, so
nothing new is silent. The two `pages.length === 0` ternaries in that
function read a little repetitively; folding them would mean building the
page block and the armed block in one branch, which reads worse. Left as
is.
