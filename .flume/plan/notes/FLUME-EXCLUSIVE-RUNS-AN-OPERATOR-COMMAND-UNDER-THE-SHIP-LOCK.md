# flume exclusive — two findings the verb surfaced

**`operatorLog.info` writes to stdout, and the CLI's own page says narration
is stderr.** `docs/CLI.md`, *Narration carries the instant it was written*
pairs stamped narration with stderr and a verb's unstamped listing with
stdout. A stamped line on stdout fits neither half, and that is what
`stampedLogger` (`src/cliLog.ts`) produces for `info`: its sink is
`consoleLogger`, whose levels are the engine's. For this verb that is not
cosmetic — stdout belongs to the operator's command, so a wait line there
lands in `flume exclusive -- git rev-parse HEAD > sha`. `src/cliExclusive.ts`
builds a sink of its own, every level on stderr, cited at the site. That is
one consumer's choice taken once, but the engine has no way to say "narrate
this to stderr" short of rebuilding the logger, and the supervisor's and
dispatcher's `info` narration still goes to stdout against what the page
states. Either the page is wrong or `operatorLog` is; a human should pick,
and the fix is probably one sink in `src/cliLog.ts`.

**`EX_MOUNT_DEAD` is the name 69 carries, and this verb returns 69 for a
resolution failure that is not a chain.** The verb takes it twice — a cwd git
holds no repository for (nothing to lock), and a command that never started —
both "a mount or resolution failure" per `.claude/rules/platform-facts.md`,
*Exit codes come from `sysexits.h`*. The constant's name reads false at both
sites. Pre-1.0 the honest fix is renaming it `EX_UNAVAILABLE` in
`src/exitCodes.ts` and at its callers; too wide for this entry.

**One behavior change past the entry:** the per-subcommand `--help`
short-circuit in `src/cli.ts` now reads only the words ahead of `--`
(`splitAtSeparator`, `src/cliArgs.ts`), so `flume tick -- --help` is a
trailing-positional refusal rather than a help page. No suite pinned the old
reading.
