# The slice-state sentence enumerates four rules; five are in play, and the enumeration sits one clause above a pointer at the table that holds them

`spec/harness.md:97`–`:102` names what the slice-state gate refuses:

> a cursor an ancestor of the tip and a descendant of its pre-commit value,
> the sweep's stamp moving only on the tick that closes its rotation, the
> covered set only growing while a rotation stands open, the retired-claim
> cursor advancing only over lines the commit could have searched

Four clauses. The inbox slice's lane-stamp rule — `lanesKeepTheStampsTheyHave`
(`harness/planState.ts`), shipped at 0d8af80b — is a fifth, and the sentence
does not carry it. Raising rather than deriving: the page is yours, and the
two ways out are authorship calls, not defects a cite decides.

**Measured this drain.** `SLICE_STATE_RULES` (`harness/planState.ts`) holds
`plan-derive: []`, `plan-sweep: [stampsOnlyOnTheTickThatCloses,
coveredOnlyGrowsWhileOpen]`, `plan-inbox: [lanesKeepTheStampsTheyHave]`. So
of the sentence's four clauses, two are rules in that table, one (cursor
ancestry and descent) is the gate's own check over every declared cursor
rather than a table entry, and one (the retired-claim cursor) names a rule no
tree holds yet — it is
THE-SWEEP-CARRIES-A-RETIRED-CLAIM-CURSOR, still queued. That last one is fine
by the corpus's own posture: the page states the ship target beside current
truth. The omission is not.

## The forks

1. **The list takes a fifth clause.** "a lane's drained-run stamp never
   disappearing from the file" or equivalent, beside the other four — and each
   future slice's invariant joins it as that slice lands. Cheapest today;
   the cost is that the sentence is now a roster the next rule must remember
   to join, and the failure mode is exactly the one this drain caught: a rule
   ships, the roster does not move, and nothing reds.

2. **The list stops being a roster** and keeps one clause as the *kind* of
   thing the gate refuses, pointing at the table for the set. This is what
   I would write, because the pointer already exists three sentences down —
   "The rules ride the table beside each slice's accessors, so a fourth
   slice's invariant arrives at a table that exists" — so the enumeration is
   a second copy sitting beside a pointer the section already makes. Under
   this reading the roster is the defect rather than its gap, and fork 1
   re-buys the gap for the sixth rule.

**What no fork can buy.** Neither makes the sentence mechanically held. The
ladder does not administer `spec/` — prose about the harness is its authors'
(`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*) —
so a roster stays a roster nothing counts, whichever way this goes. That is
the argument for fork 2: the only enumeration that cannot go stale is the one
that is not there.

No entry is scoped off this. Under fork 2 there is no code change at all;
under fork 1 the edit is yours, since autonomous phases never write `spec/`.
