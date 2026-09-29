# Both refill-read arms now reach the tick's facts

Shipped as filed. Arm 1: `refillWalled` became `refillParseFailure`
(`src/waveTick.ts`), reported on `TickResult.queueParseFailure` beside the
opening read's — one field, since a handoff asks whether this tick's queue
resolved, not which read asked. Arm 2: a refill read the fence refuses now
leaves through `waveReadRefusal` (`src/waveMerge.ts`), a `WaveLedgerRefusal`
carrying the settled wave's verdict; `ledgerRefusal` took a `site` param so
the summary says which read or write refused.

Two observations for plan:

1. `spec/pending.md`, *Queue reads are strict* lists the strict reads as "the
   singleton and fanout decide-reads and the wave-end rewrite read". A wave
   takes the fanout decide-read twice — once opening, once per freed slot —
   and the two differ in consequence: the opening one refuses before any
   agent ran, the refill one refuses with spans on trunk. The spec sentence
   is not contradicted, but it does not distinguish them, and this entry
   existed because the code did not either. Human's call whether the section
   wants the refill read named.

2. `slotError` (`src/waveTick.ts`) still throws bare for every cause that is
   not a `PendingParseFailure` — an agent that exploded, a hook that threw —
   so a wave that shipped two spans and then lost a slot leg still loses its
   verdict. Same shape as this entry, one layer out: the wrap is keyed on the
   cause because only the ledger read is a ledger refusal, and a verdict for
   the other causes needs a class that is not `WaveLedgerRefusal` (its
   `refusalClass` would have to lie). Not filed here; it is a decision, not a
   mechanical fix.
