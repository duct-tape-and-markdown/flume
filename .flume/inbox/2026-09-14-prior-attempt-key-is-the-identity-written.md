# Prior-attempt map: key by the identity the chain wrote, not its slug (interactive session)

Observed at 07b550c. Rules *The prior-attempt map keys a singleton by the phase-name slug* the other way from that question's recommendation: the engine conforms to the three sentences; the sentences stay.

`src/priorAttempts.ts` — `readAll` keys `TickContext.priorAttempts` by the filename stem (`slugify(key)`), and the record body carries only the keyspace (`key: "entry" | "phase"`), never the raw tag or phase name written. A chain whose phase is `plan_sweep` looks up by name, reads no prior, and the retry silently loses its predecessor (`engineering.md`, *Loud or nothing*). Not live here (slug-shaped names); live for a consumer naming phases freely.

Fix at the mechanism: the record stores the identity written alongside the keyspace, and `readAll` keys the map by it. The stem stays slugged. Records are gitignored runtime state, so no migration. `priorAttemptRef`'s phase leg and the `TickContext.priorAttempts` doc take the same wording. One entry; the `.flume/chain.ts` `parkStanding` half (compare raw `e.tag`) is `chore(flume)`, interactive.
