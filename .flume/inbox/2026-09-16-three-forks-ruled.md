# Ruled: capabilities row, `help <subcommand>`, and a docs page's interface claim

Closes the three questions parked at 27d87c3b, each on its recommendation.

- *Does the harness declaration mirror `Chain.capabilities`?* — (a): a
  `capabilities` row, passed through whole; `jobs[name].capabilities` adds
  to the shared set, so (b) is the same object later. `spec/harness.md`.
- *What does `flume help <subcommand>` answer?* — (c): that subcommand's
  `--help`; an unknown name is usage-shaped, exit 2. `spec/cli.md`.
- *Is a `docs/` page's claim about a live interface pinnable?* — (a):
  `engineering.md` *Narration is the ladder's bottom rung* gains the third
  carve-out — a docs or README passage stating what a shipped interface does
  may be pinned against that interface, never against another page. The
  node-version table restates a rule page and stays prose. The sweep domain
  does not widen: the retired-claim lens already reads `docs/` and the
  README on every spec delta (`posture-sweep.md`), which is the re-read the
  question was missing.
