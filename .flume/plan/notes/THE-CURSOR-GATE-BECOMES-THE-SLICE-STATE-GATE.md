# The slice-state table is ready for the retired-claim cursor

Shipped: `SLICE_STATE_RULES` (`harness/planState.ts`) holds each slice's
invariants as a rule over `(at, base)` states; `judgeSliceState` parses both
ends once and returns that slice's cursor steps plus its broken rules. The
gate (`harness/gates.ts`, now named `slice-state`) walks `JUDGED_SLICES`,
never a field. Sweep has two rules: the stamp moves only on the closing tick,
and an open rotation's covered set only grows.

For THE-SWEEP-CARRIES-A-RETIRED-CLAIM-CURSOR: the cursor joins `CURSORS` and
its "advances only over lines the commit could have searched" rule joins
`SLICE_STATE_RULES["plan-sweep"]`. Neither the gate nor its tests need an
edit — that is the acceptance this entry bought.

Three things worth knowing:

1. The gate's old rule fired only on a *changed* cursor value, which is why
   160 covered modules stood behind the open rotation with nothing holding
   them. Rules now read the pair, so an arming tick (stamp unchanged) is
   still green and a shrink is refused. Pinned both ways.
2. `CURSOR_FIELDS`, `CursorStep` and `SliceStateJudgement` are module-private
   now — `gates.ts` was the only consumer of the first, and the export pin
   reds an unreached export. `SliceStateAt` stays exported for the tests.
3. Debt, not filed: `short(sha)` is spelled in `harness/gates.ts` and twice
   inline in `harness/judge.ts` (`.claude/rules/engineering.md`, *A module is
   one job* — a helper spelled in three modules has one home). I kept the
   rule clauses sha-free rather than adding a fourth copy, which is why the
   refusal reads `plan-sweep state at <sha> is not a move its own invariants
   allow: <clause>` with the shas contributed by the gate.

`docs/CHAIN-AUTHORING.md`'s gate inventory carries the rename. `CHANGELOG.md`
line 21 names the old gate in a shipped release note and was left alone.
