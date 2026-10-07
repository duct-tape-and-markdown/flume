# Who refuses on a blocker tag no queue entry carries?

Build note from `SELECTION-REPORTS-A-BLOCKER-NO-QUEUE-ENTRY-CARRIES`
(2026-10-07). The engine side shipped and is complete; this is the
consumer-side half, routed here because every candidate home is a sentence in
a human-held page.

## What ships today, measured on this tip

`spec/pending.md`, *Pickability*: "**A blocker no queue entry carries counts as
landed** — absence from the queue is how a ship reads — so a restored or
relocated queue stays runnable. Selection reports such tags on
`TickResult.unresolvedBlockers`, a fact a chain **may** refuse on."

`grep -rn unresolvedBlocker src/ harness/ docs/ tests/ spec/` on this tip: the
field is written by `src/selection.ts` and carried through both concurrencies,
documented on `docs/CHAIN-AUTHORING.md`, and pinned in `tests/Dispatcher.test.ts`.
**No reader anywhere** — not `harness/handoff.ts`, not the CLI.

So a misspelled `blockedBy` makes its entry pickable *immediately*, and build
ships it before the upstream it declared. That is the failure
`plan-discipline.md`, *A parent is containment; `blockedBy` is order* names out
loud — "a dependency you leave undeclared is not a gate the scheduler forgives,
it is a **wrong order no gate can see**" — except here the dependency *was*
declared, and the typo silently converted it to no dependency at all. Nothing
in flume's own loop says a word.

Nothing is biting right now: no entry in the queue carries a `blockedBy` gate
at all, so this is the next typo's cost, not a live stall.

## The tension the answer has to hold

The permissive read is not an oversight — the same section buys a property with
it: "absence from the queue is how a ship reads", so a blocker that *shipped*
drops out of the queue and its waiter unblocks with nothing to update, and a
restored or relocated queue stays runnable. **A refusal that cannot tell a
typo from a shipped blocker takes that property back.** Neither can be told
apart from the queue alone — which is why the engine reports the fact instead
of deciding.

## The three candidate homes, each a human's sentence

1. **The default handoff refuses the entry.** `spec/harness.md`, *The default
   `handoff`* declares a floor of exactly two things — the producer-resolved
   refusal and the stop write after a contract-touching ship — and a wake set
   above them. A third floor behavior is a new sentence there. Costs: the
   strongest answer, and the one that most directly undoes the paragraph above —
   a restored queue would now stall rather than run. Also the only option that
   reaches an unattended loop.
2. **`flume status` names it.** `spec/cli.md`, *`flume status` owes exactly
   this* is a closed roster, and its row 7 already carries the sibling shape:
   "one line per pending entry blocked on a `requiresCapability` the chain has
   not asserted". An unresolvable blocker tag is the same class — a gate no tick
   can ever satisfy — so the precedent is a row, not a refusal. Costs: reaches
   an operator who looks, and nobody else; an autonomous run ships the entry
   anyway.
3. **The handoff writes a friction note.** The declared channel exists
   (`.flume/declaration.ts`, `friction: "friction"`), `flume status` and the
   loop-end summary already print its count, and the next inbox tick drains it —
   which is the producer that can actually fix the typo. Costs: the handoff
   "writes exactly one thing: the stop flag" today, so this is a second write
   and a new sentence in the same section as option 1; and the entry still
   ships out of order once before anyone reads the note.

(2) and (3) compose and neither takes back the restored-queue property, since
neither refuses anything. (1) is the only one that stops the out-of-order ship,
and the only one that costs the property.

**Lean:** (3) plus (2). The fact wants a producer, and the producer is the
drain — the same route `queueParseFailure` already takes for an inherited queue
defect only a producer can clear. If the out-of-order ship is judged
unacceptable, (1) needs a discriminator the queue cannot supply today, which
would be a separate engine ask.

## Also in the note, not asked here

`parsePendingQueue` already refuses a `step` whose `blockedBy` names no entry in
the queue (the step-scope arm), so whatever is decided reaches `work` and
`group` entries alone.
