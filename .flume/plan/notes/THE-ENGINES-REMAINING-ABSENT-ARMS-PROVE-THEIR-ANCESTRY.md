# Three of the five absent arms sit behind Baton's mkdir

All five arms now prove their descent (`existsLoudUnder`, `src/fsProbe.ts`;
`frictionNotes` takes its root). But only two are reachable from a fixture:
the friction listing, and `status`'s tip claim (root = git common dir, four
rungs under it). The three rooted at the state root are not.

Measured this tick: `new Baton(flumeDir)` `mkdirSync`s `<flumeDir>/awake`
(`src/Baton.ts:63`) before any of them — `cli.ts:324` for `status`,
`cli.ts:897` (the Dispatcher) for `tick`/`loop`. An obstructed state root
refuses there, on posix as ENOTDIR and on win32 too (node's recursive mkdir
stats the EEXIST and throws ENOTDIR), so `loop.pid`, `stop` and `loop`'s
start refusal can only see the obstruction if it appears after that mkdir.
Kept them uniform anyway — the guards are correct and cheap, and the earlier
refusal is incidental to them. The pin lines could only assert the verb
refuses and prints no lock reading; the rung each refusal names is pinned at
the probe (`tests/fsProbe.test.ts`).

Two things for plan out of that ordering:

1. `flume status` over a state root that is present and is not a directory
   exits 1 with a raw stack out of that mkdir. `src/cli.ts:336`'s own comment
   calls exit 1 "the one exit `status` is specced never to take"
   (spec/cli.md, *Subcommand surface*), so the verb contradicts it on this
   input. Same finding's other half: an observational verb creating
   `<flumeDir>/awake` at all.

2. `src/loopSupervisor.ts:820` reads the stop flag per tick off the bare
   probe — the same file, the same silent arm, outside this entry's list, so
   left alone. Its site declares the disposition and the boundary's
   `baton.hibernating()` readdir bounds it, but it is the one arm of the
   family that still reads an unproven root as "no stop requested".
