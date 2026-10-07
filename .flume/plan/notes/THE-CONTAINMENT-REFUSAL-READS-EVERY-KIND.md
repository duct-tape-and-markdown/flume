# The containment refusal now reads every kind, and two things it surfaced

**One edge, one refusal.** Dropping the `kind === "work"` guard put a step
waiter under both arms at once: its work entry and the groups above it are in
its containment *and* outside its blocker scope, so the two loops would have
refused one edge twice and `soleForestError` (a standing pin) would have red.
The two arms are now one loop over every `blockedBy` entry, containment read
first: a containment edge can be declared nowhere, so the step scope's escape
("declared on the work entry") is wrong advice for one, while every edge the
containment admits is exactly where that escape is right. Precedence is a
judgment call, not a mechanical consequence — if plan wants the step-scope
wording to win for a step blocked on its own work entry, that is a one-line
swap.

**The spec states one of these rules and derives the other.**
`spec/pending.md`, *The queue is a forest* spells the step scope outright but
says nothing about containment for any kind; the whole containment rule lives
in `src/PendingSchema.ts` prose, derived from *Pickability*'s gate inheritance
plus "a group leaves the queue in the ledger commit that ships its last
descendant". The refusal is now kind-independent, which makes it a forest rule
in its own right — a candidate bullet for that section, human-surface and not
a build tick's to write.

**Debt, not queued.** The containment arm builds its ancestor set with a
hand-rolled walk bounded by `maxEntryDepth` while `ancestorsOf`
(`src/PendingSchema.ts`) is in the same file, cycle-safe and uncapped. Not a
free swap: an uncapped walk would add containment refusals above the cap for
an over-deep chain, which the depth rule already refuses, so the merge would
change what a doubly-defective queue reports. Fileable against
`engineering.md`, *The fix lands at the mechanism* if it recurs.
