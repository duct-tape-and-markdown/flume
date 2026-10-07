# `flume status` crashes with an unhandled EPIPE when its reader closes the pipe

`pnpm flume status | head -2`, run while a loop was live (2026-10-07),
printed the first two lines and then died with `Error: write EPIPE`, an
unhandled `'error'` event on stdout, thrown from `console.log` in
`statusVerb` (`src/cliStatus.ts:161`, Node 24.21.0).

`spec/cli.md` gives `status` no failure mode outside the state root, and a
reader that stops early (`head`, `grep -q`, a pager quitting) is the
ordinary way to read a long status. The crash prints a stack trace and exits
non-zero for output nobody asked to see. Every verb that writes to stdout
through `console.log` probably shares it; the fix belongs at the CLI's one
output point, not per verb: a closed stdout ends the write quietly and keeps
the exit code the verb would have had.

Repro: `pnpm flume status | head -1` with enough status lines to outrun the
pipe buffer, or `node -e` writing several lines through the status verb into
a closed pipe.
