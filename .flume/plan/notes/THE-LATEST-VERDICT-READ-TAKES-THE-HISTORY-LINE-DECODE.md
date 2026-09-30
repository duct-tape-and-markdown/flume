# The fold landed; the probe-then-read leg is the next copy in the same module

Shipped as written. `readTickVerdict` (`src/tickVerdict.ts`) now returns
`decodeVerdictLine(raw)`; the guard body is gone, so the module holds one
spelling of "parse this text and take it iff `isTickVerdict` does". No test
edited, suite green (2177 passed), tsc clean.

Two things the next plan tick may want.

1. The entry's line cites were already stale when this tick opened it — the
   file is 1666 lines now (61a0302c moved the agent-spend fold out), so
   `readTickVerdict` is at :1524 and `decodeVerdictLine` at :1585, not :1655
   and :1716. The bodies matched byte for byte as described, so the premise
   held; only the coordinates had moved. Cites read off one tick's tree are
   worth spelling as symbol names alone where the entry does not need the
   line.

2. Sibling family, same module, unfiled: **the probe-then-read leg is spelled
   three times.** `readTickVerdict` (:1524), `readVerdictLogLines` (:1553),
   and `readLatestVerdictsSync` (:1642) each run the same sequence —
   `namespacedJoin`, `existsLoudUnder` from the state root returning the
   empty reading, `readFile`/`readFileSync` in a try, `throw unreadable(...)`
   on the catch — differing only in the artifact label, the empty value, and
   sync vs async. That is `engineering.md`, *A module is one job*'s "a second
   copy of a sequence — two legs that spell the same steps and differ only in
   how they return". It is load-bearing: each copy is the *Loud or nothing*
   refusal, so a fourth reader added beside them can drop the descent and
   read as correct. Whether the sync/async split admits one home is the
   design question — `readFileSync` cannot be awaited, so the shared piece is
   probably "probe and hand back the path, or the empty reading" with the read
   left at each site, which is a thinner win than the three-way duplication
   suggests. Noting it rather than deciding it.
