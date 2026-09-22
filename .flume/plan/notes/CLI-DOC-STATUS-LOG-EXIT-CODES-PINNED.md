# status crashes 1 where both surfaces promise 74

Found while driving `flume status`'s real arms for this entry. A `loop.pid`
that is present but **unreadable** (a directory in its place, `denyFile`)
exits **1** with a raw EISDIR stack trace, not 74. The try/catch in
`src/cli.ts` wraps the `existsLoud` stat alone; `liveLoopClaim` is called
outside it and throws on any non-ENOENT read by its own contract. Same shape
for the tip claim (`liveTipClaimPid`, `src/git.ts`) — probe guarded, read
not.

Both prose surfaces already claim 74 there: `docs/CLI.md`'s status section
("a file it must read is present and unreadable (`loop.pid`, the stop flag,
the tip claim ...)") and `cliHelp.ts`'s status page. So the defect is the
code, not the page — though note the page says "unreadable" while the help
says "could not be stat'd", and only the stat half is true today.

Deliberately left out of this entry's driven arms: folding 1 into the set
would make the page document a crash. The arms driven are the ordinary
observation (0) and the spend line's tick-verdicts.jsonl refusal (74),
which is guarded and does return 74.
