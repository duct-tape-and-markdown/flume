# One door now withholds a refused blockedBy edge

The withholding set (`refusedEdges`, `src/PendingSchema.ts`) is keyed on an
edge some arm refused, and both scope arms reach it through one local
`refuseEdge` — so the cycle arm drops either arm's edge. Measured before:
two work entries, one step each, blocked on each other drew 4 errors; now 2,
one per edge, each the step-scope refusal naming the field its author wrote.

Two observations for the next derive:

- The step-scope arm's "names no entry in the queue" leg now withholds its
  edge too. Harmless today — a tag the queue does not hold is not an edge in
  the cycle graph at all (`blockerCycleFrom`'s own doc says so) — so the
  withholding is a no-op there rather than a second rule. Noted because it is
  the one leg where "refused" and "could have closed a cycle" come apart.
- Nothing in the suite pinned the containment withholding by title before
  this entry; it rode on `soleForestError`'s count inside tests whose titles
  are about the containment rule. The pin now stands on its own and carries
  its own non-vacuity (the same shape with the loop running through an
  outside entry still draws a cycle refusal per edge), which is what proves
  the single refusal is the withholding and not a search that led nowhere.
