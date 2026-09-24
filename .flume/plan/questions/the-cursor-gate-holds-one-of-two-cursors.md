# The cursor gate holds one of the two cursors

`spec/harness.md`, *The gates the discipline needs* — and the fork is whether
the sentence names one cursor on purpose.

## What it says, and what the code does

The spec states the gate as "a plan commit's **derive** cursor is an ancestor
of the tip and a descendant of its pre-commit value, refused otherwise,
because a cursor stepped past commits nobody derived fails silently on every
tick after."

`cursorGate` (`harness/gates.ts:512`) holds exactly that, and only that: it
keys on `planStatePath(ctx.stateRootRel, "plan-derive")` (`:524`), parses with
`PLAN_STATE_SCHEMAS["plan-derive"]` (`:542`), and judges `derivedThrough`
(`:544`, `:553`). A commit that touches `state/plan-sweep.json` alone is
skipped on the path.

So `sweptThrough` is ungated. A sweep tick may stamp it backwards, sideways
onto a sha the commit cannot reach, or forward past commits nobody swept, and
nothing reds. The failure is the one the spec's own rationale describes, word
for word: the frontier simply never opens on the skipped span again, and the
window that results reads exactly like a quiet tree.

Both halves are as decidable for the sweep as for derive. The window hands the
closing tick the tip it was drawn from (`harness/sweepWindow.ts:161`), and
that tip is an ancestor of the commit the tick then writes; the pre-commit
value is at `ctx.baseSha`, the same place the derive arm reads it. And the
mechanism is already generic over the type: `CursorField` and the `CURSORS`
table (`harness/planState.ts:370`) name both cursors, so the gate is a branch
on one instance inside code otherwise generic over it
(`.claude/rules/engineering.md`, *The fix lands at the mechanism*).

## The fork

1. **Gate every declared cursor.** The gate walks `CursorField`, keys on each
   cursor's own slice state file, and judges each the way it judges
   `derivedThrough` today. The spec sentence widens with it ("a plan commit's
   cursors step forward over history the commit reaches"). Mechanical; the
   existing derive cases stay green; it costs two `isAncestor` calls on a
   commit that moved a sweep stamp. This is the option I would take — the
   rationale the spec gives is cursor-agnostic, and the asymmetry reads as an
   omission rather than a decision.
2. **Declare the asymmetry at the site.** The sweep cursor is insurance, not
   product: a wrongly-advanced stamp loses posture coverage, never a shipped
   entry, and the rotation's covered set is the fact a reader would check.
   Cheaper, and honest if the asymmetry was deliberate — but it leaves an
   unrecoverable silence in place, which is the thing the derive gate exists
   to refuse.
3. **Leave it.** Only defensible if a sweep stamp is expected to move by hand
   often enough that a gate would be in the way. Nothing in the discipline
   suggests that; `sweptThrough` moves on exactly one tick per rotation.

A ruling on (1) versus (2) is a spec edit either way — widening the sentence,
or stating the carve-out in it — which is why this is a question and not an
entry.
