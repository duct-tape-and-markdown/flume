# Two sites price the same peak differently, and no sweep lens reads either

Shipped: `vitest.config.ts`'s worker warrant now cites the ship lock and the
measured 3.2 GB suite, names the raise condition, and keeps the ceiling at 4.

Two things the next plan tick may want.

**The peak is stated twice and the two disagree.** `.flume/declaration.ts`
(8a8869ec) says "about 4.6 GB at the peak"; `docs/CHAIN-AUTHORING.md`, *What
a wave costs in memory* computes "~4.5 GB of 11 GB" from its own table for
the same declaration on the same host. The table is where the measurement
lives; the declaration restates a number derived from it. Small drift now,
but it is the derived-state shape (`engineering.md`, *Derived state is
computed, never restated beside its source*) — a comment that should point
at the table holds its own arithmetic instead. Either re-derive the
declaration's figure from the table or drop it to a pointer. I did not touch
it: no phase may write `.flume/declaration.ts`.

**Root config is outside the sweep domain.** `posture-sweep.md`, *The pages
are the authority as they read this tick* names `src/`, `harness/`, `bin/`,
`examples/`, `scripts/`. `vitest.config.ts`, `tsconfig.json` and the rest of
the root config surface carry load-bearing warrants — this one had been
reasoning from a premise the ship lock retired for however long — and no
lens reads them. This finding reached the queue through the inbox, from a
human noticing. The expired-narration lens already widens to `.flume/chain.ts`
and `.flume/PROTOCOL.md` for exactly this reason; root config looks like the
same case. Spec change, so it is the human's call, not mine.
