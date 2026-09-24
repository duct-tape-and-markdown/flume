# Where does a closed retired-claim delta get recorded?

**Section:** `.claude/rules/posture-sweep.md`, *The frontier is decidable; the
neighborhood is judged* — "the frontier is every site a search for the deleted
claim's key phrases turns up … **No hits closes the delta in one tick**" — read
against *The stamp*, which gives the plan state one sweep cursor and a covered
set of modules.

Raised by the note the build tick left under
`THE-SWEEP-WINDOW-NAMES-EACH-FRONTIER-PATH-ONCE`, and measured against the
shipped window this drain.

## What the state holds, and what it does not

The page says a retired claim closes in one tick. Nothing records that it did.
`plan-sweep.json` carries `sweptThrough` and `rotation.covered`, and `covered`
is module paths — the *code* frontier's coverage. The retired-claim delta has
no coverage field at all, so every tick of an open rotation re-renders every
line the locus deleted since the stamp, whether a prior tick searched it or
not. The module frontier shrinks tick by tick; the delta never does.

## Measured at this tick's tip

- The open rotation's stamp is `b7972ec4`, and the locus paths the range
  touched are 17 (9 rule pages, 8 spec files).
- The delta is **852 deleted lines** against `WINDOW_LINE_BUDGET` of 1200
  (`harness/sliceWindow.ts`) — 71% of the one budget the sweep window bounds
  anything with, spent re-rendering the same lines every tick, ~160 covered
  modules into the rotation.
- `git diff` orders by path, so the lines a crossing would truncate are not
  the newest retirements — they are whichever locus paths sort last
  (`spec/prompt.md`, `spec/worktrees.md` today). A rotation that crosses 1200
  stops showing those pages' retirements for the rest of the rotation.
- The truncation is loud, but its stated remedy is not the reading tick's to
  take: the marker says "narrow the range by closing this rotation"
  (`harness/sweepWindow.ts`), and the rotation closes only when the module
  frontier empties — ~38 ticks away by the count in
  `what-does-a-phrase-delta-arm.md`.

## The fork

1. **A second cursor, beside the stamp.** `retiredThrough`: the delta renders
   the lines deleted since it, and a tick that searched them advances it while
   `sweptThrough` stays put. Cost: a second cursor, so a may-move rule beside
   the other two in `CURSORS` (`harness/planState.ts`) and a row in
   `spec/harness.md`, *Plan state as declared state*. Gain: the delta shrinks
   like the frontier does, and a claim is searched once per rotation rather
   than once per tick.
2. **`rotation.covered` admits a claim key beside a module path.** No new
   cursor; the set the sweep already writes carries what it closed. Cost: the
   covered set stops being one vocabulary — the superset invariant
   `does-the-cursor-gate-hold-the-covered-set-too.md` is about now spans two
   kinds — and a claim needs a key stable across ticks, which a deleted line's
   text is only as long as nobody re-renders it differently.
3. **Leave it.** A retired claim is cheap to re-read and the delta dies with
   the rotation. Cost: the per-tick tax above, and the truncation arm becomes
   a silent coverage hole the moment a rotation crosses the budget — the one
   place this machinery degrades without refusing (`.claude/rules/engineering.md`,
   *Loud or nothing*).

## What I would do, and why I am not doing it

(1). It is the shape the page's own sentence implies — a delta that *closes*
is a delta something records as closed — and it is the only fork that keeps
one vocabulary per field. What stops it being an entry is that the page gives
the sweep one cursor and the spec section lists the cursors by name, so a
second one is a sentence in the human's lane
(`.claude/rules/spec-plan-build.md`); the mechanical half files against
whichever sentence the ruling writes.

Not this question: how long a rotation runs (that is
`what-does-a-phrase-delta-arm.md`) and whether the covered set is gated
(`does-the-cursor-gate-hold-the-covered-set-too.md`). This one is the delta's
own bookkeeping, which neither covers.
