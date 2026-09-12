# resolveRepoRoot's throw has no exit-code mapping at the CLI boundary

Both probes now refuse loud. The `--job` state-root guard catches and maps to
`EX_IOERR` with a named message, matching cli.ts's three `status` probes and
the `friction` read/readdir refusals.

`resolveRepoRoot` has no such mapping. It is called bare at `src/cli.ts:155`,
ahead of every try/catch in `run()`, so an unstattable ancestor `.flume` now
escapes to `main().catch` — raw `console.error(err)` stack dump, exit 1. Every
other stat refusal in the CLI exits 74 with `[flume] ...`. Left as-is: wrapping
it is a behavior decision about the walk's failure code (74? 78?), and the
entry's acceptance only asked that the walk stop rather than skip past. Worth
an entry or an open question if the asymmetry matters.

Smaller: `src/cliJobResolution.ts` now imports `./paths.js` for
`namespacedJoin` (the MAX_PATH idiom `existsLoud` callers owe), pulling
`PendingSchema` → zod into a module that previously reached only `node:path`.
No cycle, and cli.ts already loads both.
