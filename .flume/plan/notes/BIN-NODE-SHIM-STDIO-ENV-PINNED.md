# spec/cli.md Distribution's bin/flume.js claims are now fully held

Each pin bites in isolation — verified by mutating `bin/flume.js`: piping
stdout/stderr, merging fd 2 into fd 1, `stdio[0] = "ignore"`, and an injected
env var each fail exactly the pin that names it.

One claim in that paragraph has no pin of its own: **"It parses no options."**
It rides the argv case, whose fixture carries flags, a subcommand, and a `--`
passthrough, so a shim that parsed or re-quoted anything fails there.
Deliberate, not an oversight — a dedicated case would assert the same bytes
twice. Recording it so a later sweep reading the Distribution paragraph
against `tests/bin.test.ts` does not file it as a gap.

Incidental: all four `bin/flume.js` cases read the child's stdout *through*
the shim's inherited fd 1, so that leg is over-determined — the argv case
fails too if stdout stops being inherited.
