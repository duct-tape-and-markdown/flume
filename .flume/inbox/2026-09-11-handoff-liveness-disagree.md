# build.handoff and plan-inbox.shouldRun disagree on what a refusal is (human)

Loop of 2026-09-11: LOG-TAGLESS-SPAN-ROW ended its wave with
`mergeOutcomes[].outcome: "cherry-pick-conflict"`. `build.handoff`
(`.flume/chain.ts`, `refused`) read it as `committed && !shipped && !reverted`
and woke `plan-inbox`; `reconcileDue` counts only `"not-shipped"` and a
voluntary-bail record, so the slice declined. One tick to do nothing, and
the comment "a refusal only plan can resolve" is false for a conflict, which
the next wave retries from the new base. Two predicates for one fact
(`engineering.md`, *Derived state is computed, never restated*): one
predicate over the verdict, used by both, with conflict excluded.
