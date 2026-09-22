# writeTickVerdict's own history read now refuses, unclassified

Two observations from making the three readers loud.

1. `writeTickVerdict` (`src/tickVerdict.ts`) appends by reading the history
   through `readTickVerdicts`. Before this entry an unreadable log read as
   `[]` there and the write **overwrote the whole history with one row** —
   silent data loss. It now throws, which is right, but the throw escapes
   `src/cli.ts`'s tick arm uncaught: a raw stack and exit 1, where every
   other present-but-unreadable read in that file exits `EX_IOERR`. Worth an
   entry: classify it, per `spec/cli.md`'s exit-code contract.

2. `docs/CLI.md` claimed `flume status` "exits 0 regardless of state" — already
   false before this tick (three EX_IOERR stat arms). Corrected here, and
   `flume log`'s stated exit codes too. Nothing pinned either: `tests/cliHelp.test.ts`
   drives real refusals against `--help`'s exit-code block, but no equivalent
   reads `docs/CLI.md`. A docs page restating a verb's exit codes with no
   agreement gate is the shape; `engineering.md` *A seam gate reads what the
   real writer wrote* would cover it.
