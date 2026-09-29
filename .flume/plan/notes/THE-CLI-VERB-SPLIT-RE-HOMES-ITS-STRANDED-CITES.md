# One stranded cite was also a stale claim, and the `main` family is not all residue

All ten sites in the entry's note verified on disk and re-homed. Two things
the next plan tick should hold.

**`isDotName` (`src/paths.ts`) claimed two sharers; it has one.** The doc said
the predicate is shared by `frictionNotes` and "the `friction` verb's
read-by-name (`src/cli.ts`)". Repointing the path alone would have shipped a
green cite at the right door for a false claim: `git show 754afb51^:src/cli.ts`
has no `isDotName`, and the read-by-name asks `frictionNotes(...).includes(...)`
(`src/cliFriction.ts:98`). So the passage was stranded by whichever earlier
commit routed read-by-name through the listing, not by the split, and
`src/friction.ts`'s own header already said both verb arms come through
`frictionNotes`. Corrected to one caller, with the verb's route through it
stated. Worth a lens: a re-homed cite can be green and still assert a
consumer count the tree no longer has — the pin reads the token, and a
*number* in the sentence is below even that.

**The remaining `src/cli.ts` / `main` cites outside the entry's list are
correct, not a second wave.** Checked each: `src/cliArgs.ts:4` (argv split),
`src/cliBaton.ts:111` (the state-root seam — `resolveStateDirs` is still in
`src/cli.ts:218`), `src/cliHelp.ts:3` (where the module was split from), and
the `main().catch` family in `cliStatus`, `cliTick`, `cliLoop`, `cliRender`,
`cliVerdict` and the tests, each naming the top-level catch an uncaught throw
would actually have reached. A sweep re-reading this family should not file
them.

Behavior-free, as the entry says; no `tests[]`/`pins[]` claimed. Typecheck
green, full default lane green (74 files, 2094 passed).
