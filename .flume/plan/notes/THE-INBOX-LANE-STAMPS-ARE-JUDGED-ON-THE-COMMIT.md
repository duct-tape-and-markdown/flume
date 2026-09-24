# The gate's rule list in spec/harness.md no longer names them all

The inbox slice now states one rule over its own file, so `JUDGED_SLICES`
covers every declared slice and no slice is the "nothing to judge" case.

One thing for the human's spec surface: `spec/harness.md` line 97's
slice-state sentence enumerates the rules by name — cursor ancestry and
descent, the sweep stamp on the closing tick, the covered set growing only
while open, the retired-claim cursor. The lane-stamp rule this entry ships is
a fifth the sentence does not name. Either the list wants it, or the list
wants to stop being an enumeration; a build tick cannot touch either.

A judgement worth re-litigating if it bites: the rule reads the lane key
alone. A standing lane restamped at *any* other run passes, because a run
identity is opaque to this package (`DrainedRun` accepts an opaque token, not
an ordered id) — so there is no "backwards" a rule here could decide, the way
a cursor's descent is decidable. Only disappearance is caught. If a forge's
run ids turn out to be orderable per lane and the chain says so, that would be
a declared fact the rule could read; nothing declares it today.

The inbox prompt's stamping paragraph kept the directive (copy an unstamped
lane forward verbatim) and shrank its reason clause to a pointer at the gate.
