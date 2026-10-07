# The `Finished:` line is the package's spelling, and a near-miss is silent at the gate

The spec states that a session names its finished steps and that a misspelled
tag fails loudly, but no spec section states the line. `harness/putDown.ts`
picks `Finished: TAG, TAG` (lead case-insensitive, leading bullet/heading/quote
marks and `**` stripped, backticks and a trailing stop stripped per token) and
the build prompt renders it pre-filled with the entry's own tags. Consequence
worth a decision: a *near-miss lead* — "Finished steps:", "Done:" — matches no
line, so the commit ships nothing and lands `not-shipped` with no put-down
note, which routes to the drain as a standing refusal. Loud via the record, not
via the gate. The gate only bites once a line matches and names a tag the entry
does not carry. If that is too quiet, the fix is a gate arm, not a wider parse:
a shape-filtered parse would drop typos silently, which is the outcome the
section names as the one to avoid.

Two engine facts the chain was reading from the wrong side:
- `TickContext.assignedSteps` is new (`src/Phase.ts`, wired in `waveTick.ts`
  and the `flume render` preview). Build's `promptArgs` had no source for the
  steps; a fanout tick carries its assignment and no queue.
- `GateContext` still carries none, so the records gate reads the queue at the
  gated commit through `readGatedQueue` + `descendantsOf` to learn which steps
  the entry has — only when a record names something. A `steps` field on
  `GateContext` would delete that read; candidate entry.

Pre-existing: `docs/CHAIN-AUTHORING.md`'s `TickContext` table claims "every
field it declares is below" and was already missing `claimed` and
`queueParseFailure`. I added the `assignedSteps` row only.

A finishing note naming *some* steps ships those and keeps the entry queued
(then reads as a standing refusal). Deliberate — the entry rides only a list
that names every step — but it is the one incoherent case the shape admits.
