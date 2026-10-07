# The step arm of the same containment is still admitted

Shipped the work arm as written: a `work` entry's `blockedBy` naming an
ancestor or any entry in its own subtree is refused at the queue read
(`WORK_BLOCKED_BY_SCOPE`, `src/PendingSchema.ts`), stated in the rendered
`blockedBy` arm, pinned by the agreement case.

Two neighbours the arm does not cover, both measured on this tree:

1. **A step blocked on a step in its own containment parses.** The step
   scope rule only asks "same work entry", so `STEP` blockedBy its own
   `SUBSTEP` — or a substep blockedBy its parent step — is admitted. It is
   not the queue deadlock this entry fixed (both ship in one session, so
   nothing is reported queued forever); it is a contradictory *within-session
   order*, since `spec/pending.md`, *The queue is a forest* says the session
   does its steps in that order. Whether that is the read's to refuse or the
   session's to resolve is a decision I did not take. If plan wants it, the
   check is cheap — the containment map built for the work arm is the same
   one, keyed on the step instead.

2. **The group-waiter arm is untouched**, as the entry said: a `group`
   blockedBy one of its own descendants still parses, waiting on the open
   question.

Shape debt, small: the rendered `blockedBy` arm now carries three sentences
on one line. The containment sentence had to land *before* `Over the
queue: …` because the step-scope pin reads that clause with `$` anchored at
end of line and splits it on `"; "`. The arm is readable but is now the
longest line the render emits; if a third scope ever joins, the arm wants
its own rendered block rather than a fourth clause.
