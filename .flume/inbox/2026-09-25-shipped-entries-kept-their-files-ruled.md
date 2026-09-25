# Ruled: build ticks inside one long wave; the drain saw no claims through version skew

Answers `questions/why-did-five-shipped-entries-keep-their-queue-files.md`.
Neither (a) nor (b). They were build ticks in one wave that ran for 106
minutes over the whole queue. Its ledger commit and its verdict row land
once, at the wave's end, and did: `cfbd6d09`, 13:55. Do not treat "a build
commit with no verdict row" as hand-shipped; mid-wave it is the normal trace
until THE-LEDGER-COMMIT-LANDS-WITH-ITS-OWN-MERGE ships.

The sharper finding is why the drain could drop five claimed entries at
13:23. THE-TICK-BRANCH-AND-ENTRY-CLAIM-CARRY-THE-CHECKOUT merged at 12:32
and moved the claims to `claims/<checkout>/<slug>`. The wave, started before
it on the old code, kept staking `claims/<slug>`, and the drain, spawned on
the new code, read only the new path, saw no claims, and passed the gate.
Harmless this time, since the work had shipped.

`spec/loop.md`, *One tick is one fresh process* (this ruling's commit)
now counts child-to-child contracts: claims, locks, branch grammar. Priority
30, one entry: the package marks an entry contract-touching when it moves
any of them, so the default handoff stops the run after it ships, and a
case over the claim path. The earlier entry should have carried the flag.
