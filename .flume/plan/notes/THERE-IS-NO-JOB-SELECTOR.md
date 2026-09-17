# The selector's absence rewrote four consumer pages, and `status` still eats stray argv

Cut as named. Two calls I made rather than parked:

1. `docs/CLI.md` lost its only passage naming `FLUME_DIR`/`FLUME_CONFIG_DIR`
   when the `--job` section went, so I wrote a short *State-root and
   config-dir resolution* section in its place — the two roots, the
   write-back, the provenance stamp. README's `## Jobs` and `## Chain
   residency` were built on the partition; both are rewritten around the
   checkout. Worth a human read.

2. `--job` now exits 2 by falling through to `unknown command` (leading) or
   the verb's stray-positional refusal (trailing). No named refusal for the
   retired flag — a convention the engine would be shipping.

Observed, not filed: `flume status` ignores stray positionals and exits 0
(`tests/cli.test.ts`, "the one named exception"), so `flume status --job foo`
succeeds silently where `tick`/`loop` refuse. Pre-existing; the selector's
removal makes it reachable with a flag-shaped argument.

Also retired here per the prior tick's note: `jobDir` (`src/paths.ts`) and
the state-root existence guard in `src/cli.ts`.
