# The harness's interim defuse outlived its named trigger

`harness/defuse.ts` names its own retirement: "the package declares its keys
and this module goes the tick that ships." That tick is this one — the engine
capability landed — and I did not retire it, because the adoption is not the
swap the marker implies.

`defuseArgs` is applied in `harness/chain.ts` to a *computed* map: `shared(ctx)`
merged with each plan window's `args(ctx)`, and with `buildPromptArgs(...)` for
build. Every value is defused, indiscriminately. `Phase.promptDataKeys` is a
static list of key names, so adopting it means enumerating every key those
three producers can return, in three modules, kept in sync by discipline — a
second copy of a truth the producers own (`engineering.md`, *Derived state is
computed*).

The fork, plan's to pick:

- each producer exports the key names beside the args it builds, so the list is
  derived rather than restated; or
- the engine grows an all-values form (a `"*"` sentinel, or data-by-default with
  an opt-out) and the package declares that.

Until one ships, defuse stays and the engine's neutralize is a no-op over
already-broken spans — correct, but doubled.
