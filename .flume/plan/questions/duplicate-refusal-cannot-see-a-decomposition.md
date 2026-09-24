# The duplicate refusal cannot tell a collision from a decomposition

`spec/harness.md`, *The gates the discipline needs*, ratifies an `afterMerge`
gate: "a commit adding an entry whose `per` cite equals a standing entry's and
whose declared files overlap it is refused naming both."

That predicate also names every legitimate **decomposition**, which the
discipline requires (plan-discipline.md) and this tick did twice off one
section. Plan re-derives the whole ledger every tick, so the gate would refuse
the very commit that authored both siblings — and the same section's second
paragraph forbids a refusal only a hand edit clears.

The collision the section actually describes is temporal: a producer filed
against a tip that did not yet show the other entry. That is a fact git holds,
not a shape the two entries share.

**Recommendation** — key the refusal on the filing commits, not the entry
shapes: refuse when two entries with equal `per` and overlapping `files` were
added by commits **neither of which is an ancestor of the other**. One plan
commit cutting a section into siblings is one commit and passes; two concurrent
producers are unrelated commits and the second is refused. Told, not inferred
(`.claude/rules/engine-boundary.md`) — the producer's own tip is the statement,
no heuristic over summaries.

Alternatives, if that reading is wrong:

- Refuse on equal `per` + overlapping `files` + equal `acceptance`. Still a
  heuristic, and two producers describing one finding differently slip through.
- Drop the gate; let the next drain fold a duplicate into one entry and note it
  as debt. Cheapest, and loses the "lands exactly once" guarantee the section
  claims.

Until this is settled the gate is unfiled; the claim check half of the section
is queued as `THE-PENDING-GATE-CARRIES-THE-CLAIM-CHECK`.
