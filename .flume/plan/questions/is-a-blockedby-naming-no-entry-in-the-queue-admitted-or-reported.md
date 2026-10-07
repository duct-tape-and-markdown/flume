# Is a `blockedBy` naming no entry in the queue admitted, reported, or refused?

Admitted today, and deliberately: `blockerCycleFrom` (`src/PendingSchema.ts`)
treats a tag no entry carries as no edge at all, and
`A-BLOCKEDBY-CYCLE-IS-REFUSED-AT-THE-QUEUE-READ` shipped a pin fixing that as
the contract. The reason is the membership read — `settledBlockers`
(`src/selection.ts`) takes absence from the queue *as* shipped, and wave-end
bookkeeping prunes shipped tags out of `tags` (`spec/pending.md`, *Wave
auto-unblock*) — so a blocker outside the queue has, by the engine's own
reasoning, already landed.

Which makes a typo'd blocker a silently open gate that reads as a satisfied
dependency: the entry ships ahead of the work it was meant to wait for, nothing
reports it, and the only symptom is the wrong order. Nothing in *Pickability*
states the admission either, so a producer cannot read it off the spec — it is
inferable only from `settledBlockers`.

- **Keep it, and say so.** *Pickability* states that a blocker the queue does not
  hold counts as landed. No code moves; the contract stops being implicit.
- **Report it.** The engine names the blocker tags no queue entry carries on a
  reporting surface (`TickResult`), a fact rather than a verdict, and the chain
  decides whether to refuse (`.claude/rules/engine-boundary.md`, *Routing rule*).
  Keeps a hand-restored queue runnable, makes the typo visible.
- **Refuse it at the read.** Loudest, and it refuses a queue whose blockers
  genuinely shipped long ago — a restored ledger, a queue carried across a
  relocation — until the author prunes the names by hand.

The second reading is the one the posture pages point at: the engine holds the
fact and currently reports nothing.
