# The plan-state span is now copied verbatim in all three slice prompts

Shipped: `harness/prompts/plan-inbox.md` gained the `<plan-state>` block, and
a roster pin (`every plan slice prompt opens a span on the plan state file it
owns`) now reds any future slice that names `{{PLAN_STATE_PATH}}` in
`<artifacts>` without opening it.

Observed while doing it: the span itself —

    !`p="{{PLAN_STATE_PATH}}"; test -e "$p" || { echo "(no plan state yet)"; exit 0; }; cat "$p"`

is byte-identical in `plan-derive.md:13`, `plan-sweep.md:7`, and now
`plan-inbox.md:29`, and so is the `<plan-state-shape>` block beside it. That
is three copies of one guard whose fork the suite treats as load-bearing
(`tests/harnessPrompts.test.ts`, the guarded-span cases: absent takes the
placeholder, a *failed read* must reach the renderer — a trailing `|| echo`
answers both with the same bytes and was a shipped defect once). A fourth
slice would be a fourth hand-copy of that fork, and a one-character drift in
one copy reads green everywhere the detector only asks whether the path is
substituted.

Not filed as an entry: prompts are markdown the engine renders, and the
package ships no include mechanism — the fix would be either a rendered arg
carrying the state's bytes (moving the read out of the prompt, which the
odd-root cases exist to hold at the span) or a prompt-fragment surface, and
picking between those is a design fork, not a mechanical edit. Offered as
debt; if the fork is worth opening, it is a question naming the two, not an
entry.

Also: the inbox stamping paragraph now names `<plan-state>` and says the file
is rewritten whole, so a lane not re-stamped this tick is copied forward from
there. That sentence is prose holding an invariant nothing mechanical checks —
the slice-state gate judges direction for the two cursor slices only
(`JUDGED_SLICES`), and a dropped `drainedRuns` key passes it.
