# Does the cursor gate hold "the sweep cursor moves only at close"?

Note THE-CURSOR-GATE-HOLDS-EVERY-DECLARED-CURSOR, written by the tick that
widened the gate from `derive cursor` to `plan cursors`, flags the half it
did not take:

> The gate holds each cursor's **value** and nothing else about the artifact
> it rode in on. [...] a tick that advances the cursor while leaving a covered
> set describing a frontier nobody drew is still green here.

The note reads that as judgement and leaves it in the prompt. It is not — one
half of it is decidable from two stored fields, and that is the fork.

## What is decidable

`.claude/rules/posture-sweep.md`, *The stamp*: while a rotation is open the
cursor is **copied forward verbatim**, and "the tick that closes the rotation
stamps exactly that tip". `harness/prompts/plan-sweep.md:39` says the same to
the agent, and `harness/sweepWindow.ts:164` renders it into every sweep
window. So:

> If `sweptThrough` moved between the base and the gated commit, the
> `rotation` at that commit is `closed`.

Both halves are in the same file the gate already reads at both refs. No git
beyond the two `readFileAtRef` calls it already makes. The bootstrap case
falls out for free: with no state at the base there is no move to judge, which
is how the existing direction half already behaves.

The *other* half — whether the covered set names modules a tick actually read
— is judgement and stays prose. Nothing here proposes gating that.

## Why it is not already filed

Widening the gate widens `spec/harness.md`, *The gates the discipline needs*,
which enumerates the bound as complete:

> the cursor gate: each cursor a plan commit moves [...] is an ancestor of the
> tip and a descendant of its pre-commit value, refused otherwise

A second refusal with a different reason makes that sentence incomplete, and
spec is the human's surface. Hence a question rather than an entry.

## The failure it would catch

A sweep tick that stamps while open leaves the next tick re-deriving a
frontier from the new cursor while `covered` — settled for the rotation —
suppresses modules drawn from the old one. Silent coverage loss, in the
direction that looks like work getting done: exactly the class the gate's own
doc names ("Both halves fail the same silent way and that is why they are
gated"). Insurance on insurance, though: the rendered window tells the tick
what to stamp, so the arm fires only on a tick that ignored it.

## Options

**A — gate it, one clause in the spec.** Mechanism at the table, not a branch:
`CURSORS` (`harness/planState.ts`) already binds each cursor to its owning
slice and its accessor, so the entry carries a per-cursor "may this cursor
move, given its slice's state at this commit?" beside `at` and `of`. Sweep's
declares the rotation rule; derive's declares none. The gate stays generic
over `CURSOR_FIELDS` — which is what its own doc cites *The fix lands at the
mechanism* for. Costs: one spec clause, one table field, one gate test.

**B — rule it judgement, and say so at the site.** The gate doc's carve-out
currently names only the *leading-run* half as judgement; the pairing would
need naming there too, or the next reader files this again. Costs: a doc edit,
no mechanism. Accepts the silent-loss arm.

**C — status quo.** The property is stated in three places (rule page, prompt,
rendered window) and owned by none of them mechanically. This is what the tree
has today, and re-filing it is the recurring cost.

**Recommendation: A.** The property is decidable, the mechanism is a table
field rather than a special case, and the gate exists precisely because this
family of cursor defect reads as a quiet tree. If the spec clause is not worth
it, B — but not C, which is how a checkable predicate outlives the reader who
noticed it.
