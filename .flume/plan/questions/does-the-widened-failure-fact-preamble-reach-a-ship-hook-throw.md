# Does "every failure fact the verdict records" reach a ship-hook throw?

`spec/loop.md`, *Repeated identical failures — quarantine, then abort* widened
its preamble from "every per-entry failure fact" to "every failure fact the
verdict records" (4d0eab7d), then enumerates five stages. One failure fact on
the verdict sits in neither: a `shipped` hook that *threw*, recorded on the
merge outcome (`spec/loop.md`, *Prior-outcome feedback to the retrying tick*, `not-shipped`;
`TickVerdictMergeOutcome.threw`, `src/tickVerdict.ts:536`). The supervisor
derives it as an errored tick (`src/loopSupervisor.ts:715`) and folds it into
no streak, so a predicate that throws deterministically is re-run every wave to
`--max` — the burn shape the section opens by naming.

Derive filed nothing for it: the enumeration is the spec's, and extending it is
the ruling `harness/standingRefusal.ts` already says belongs where the
enumeration is, not in a slice's derivation.

- **(a) The preamble summarizes its five bullets.** No change; a thrown
  `shipped` stays an errored tick and nothing else. Cheapest, and the field has
  measured no such wall.
- **(b) A sixth `ship` stage.** Signature the thrown message, blamed on the
  entry whose merge outcome carries it, so it quarantines *and* feeds the
  backstop. Cost: a chain's own broken hook then holds the entry, which reads
  right — the hook is the defect, not the work — but no bullet says so today.
- **(c) Backstop only, like `platform`.** The throw is the chain's defect, not
  this entry's, so blame nothing and let the streak bound it.

Recommendation: **(c)** if a thrown `shipped` is the chain's defect, **(b)** if
it is the entry's. That is the same fork the `blamesSpan: false` gate arm
already answers one stage over — a failure the chain declared unblamable feeds
the backstop alone — which argues (c) is the consistent reading.
