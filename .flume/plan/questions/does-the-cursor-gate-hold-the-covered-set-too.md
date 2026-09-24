# Does the cursor gate hold the covered set too?

**Section:** `.claude/rules/posture-sweep.md`, *The frontier is decidable; the
neighborhood is judged* — "Covered is settled for the window. A later tick
never re-sweeps or re-draws it, even where fresh judgment would cut the
boundary differently — the cursor decides coverage, never re-derivation."

Raised by the note the build tick left under
`THE-CURSOR-GATE-READS-ITS-SLICES-STATE-AT-THE-COMMIT`, and verified against
the shipped gate this drain.

## What the gate holds now, and what it does not

`CURSORS` (`harness/planState.ts`) carries a may-move rule beside each
cursor's value, and the cursor gate (`harness/gates.ts`) reads whichever rule
the cursor it holds carries. Sweep's says the stamp may not step while the
rotation is open, exactly because — the gate's own doc — "a cursor stamped
under an open rotation loses that rotation's covered set on the next tick".

The rule fires only where the cursor's **value changed**. That is deliberate:
a tick that arms or extends a rotation rewrites sweep's state file without
moving the stamp, and a gate keyed on the touched path alone would refuse the
tick that opens a rotation. The consequence is that the covered set itself is
held by nothing. A plan commit that drops modules from `rotation.covered`, or
empties it, while the rotation stays open moves no cursor, so no rule is read
and every half of the gate passes.

It fails the same silent way the stamp case did: the next sweep tick re-draws
a neighborhood it already covered, and reads as ordinary work. Today's
rotation has 160 covered modules behind it (`plan-sweep.json`), so the loss is
not hypothetical — it is roughly a hundred ticks of paid coverage with no
mechanical floor under it.

## The fork

**(a) The gate widens to slice-state invariants generally.** A table keyed by
slice, each entry a `(base state, commit state) -> refusal | undefined`; the
two may-move rules become instances of it rather than a shape of their own.
Cost: the cursor gate stops being about cursors, and its name and its spec
sentence both move. Gain: a fourth slice's invariant arrives at a table that
already exists, which is the argument `CURSORS` itself was built on.

**(b) One sibling rule, on the sweep slice alone.** "While the rotation is
open across the commit, `covered` only grows" — decidable as stated: cursor
unchanged and rotation open at both base and commit implies the commit's
covered set is a superset of the base's; arming (closed at base, open at the
commit) starts from nothing and is unbounded; closing moves the stamp and is
already judged by the may-move rule. Cost: a second shape beside the cursor
table for one property, which is the special case `CURSORS` exists to absorb
(`.claude/rules/engineering.md`, *The fix lands at the mechanism*).

**(c) Neither — the property stays the sweep prompt's judgement.** Coherent
only if a shrinking covered set is recoverable by reading the artifact. It is
not: the file reads as a covered set either way, which is the test
`.claude/rules/engineering.md`, *Loud or nothing* applies to the other two
halves of this same gate.

## What I would do, and why I am not doing it

(a), with (b) as the cheap read if the general table does not earn itself: the
property is decidable, the failure is silent, and the ladder puts a decidable
property at a gate rather than in a prompt paragraph.

What stops it being an entry is the spec, not the mechanics.
`spec/harness.md`, *The gates the discipline needs* states the cursor gate as
a rule about **cursor moves** — "each cursor a plan commit moves ... moves
only when its slice's own state at that commit allows it". A refusal over a
non-cursor field is gate behavior that section does not state, and a consumer's
plan ticks meet it. Ruling wanted on which of the three, after which the
mechanical half files against the sentence the ruling writes.
