# A consumer's declared `handoff` still runs beneath the package's refusal

`spec/harness.md`, *The default `handoff`*, states two things under one
heading: the ladder, and the refusal ("It never hands build an entry whose
latest prior attempt is a clean exit at the current HEAD"). It closes with "A
consumer overrides the handoff by declaration, not by copying it."

The tree reads that as covering the ladder alone. `defaultRefusesEntry`
(`harness/handoff.ts`) is wired as `Chain.refusesEntry` unconditionally in the
factory (`harness/chain.ts`), because the declaration carries no per-entry
knob — so a consumer that declares its own `handoff` for build still gets the
package's per-entry refusal beneath it. The site declares and cites that
divergence, so nothing is wrong today; no consumer in this tree declares a
handoff, so nothing observable turns on it either way.

Which reading is intended:

- (a) **The refusal is the package's floor.** The ladder is replaceable per
  phase; the predicate under it is not, because re-dispatching an unchanged
  world is the same outcome whoever ordered the phases. The section says so in
  a clause, and the closing sentence is scoped to the ladder.
- (b) **It is a gap.** The declaration grows a per-entry override beside
  `handoff`, and a consumer that wants its own refusal states one. Costs a new
  declared field on a surface a build tick would not widen unasked, and the
  strict schema's bar ("a field the package never reads…") applies to it.

Shipped as (a) and citable as such; the ask is only whether the section should
say it, since a downstream consumer declaring a handoff learns the answer from
behavior otherwise. (a) with the clause is the recommendation.

Raised by the build note on THE-HANDOFF-DECLINES-A-CLEAN-EXIT-AT-THIS-HEAD.
