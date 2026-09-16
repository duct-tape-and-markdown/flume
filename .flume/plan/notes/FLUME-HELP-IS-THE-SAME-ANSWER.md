# `flume help` shipped; two facts for the next derive

Shipped as one arm on the top-level branch in `src/cli.ts` (`--help` / `-h` /
`help`), so the answer is `HELP_TOP` to the byte and no second usage string
exists. `-h, --help` in that text and docs/CLI.md's opening paragraph now
name the bare verb.

1. The entry's summary said the refusal was exit 64. It was exit 2 — the
   usage class (`unknown command: help`, `src/cli.ts`). 64 is `flume-harness`'s
   unknown-verb code, not the engine's. No behavior rides on it; the record
   was just wrong.

2. Judgment call, spec silent: `flume help status` prints the top-level help
   and ignores the trailing positional, because the arm is `--help`'s and
   `flume --help status` has always done that. The trailing-positional
   refusal class in `spec/cli.md` is written over subcommands, and `help` is
   not one (`isSubcommand("help")` is false, it has no `HELP_SUB` entry).
   The other readings — refuse exit 2, or route `help <cmd>` to that
   subcommand's page — are both defensible surfaces; if either is wanted it
   is a spec sentence and a second entry, not this one.
