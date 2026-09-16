# Build notes wake a plan tick after every wave (interactive session, flume-main)

Observed: every build wave in loop 33 left one note per entry, and each
wave was followed by a plan-inbox tick to drain them before build could
take the next batch. Most notes routed to an accepted-debt line or an
amendment to an entry already queued; the queue was rarely changed by the
drain, and build waited on it every time.

Why it matters: the sweep already yields to pickable work
(`.claude/rules/posture-sweep.md`); the inbox slice does not, so notes cost
a plan tick per wave whatever they carry.

Proposed (`spec/harness.md`, *Records as one file each*): while
`<pending-now>` carries a pickable entry, notes wait, and the drain rides
the next plan tick that runs for its own reasons. One fork: a **park** must
reach plan before build re-picks the entry — either a park wakes the slice
and an observation does not, or build skips an entry whose note stands.
The first is one predicate on the record's kind.
