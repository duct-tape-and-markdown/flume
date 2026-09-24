# Should the citation pin resolve backticked identifiers on `docs/` pages?

`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*
resolves "a backticked identifier or a backticked repo-relative path in
`src/`, `harness/`, or `tests/`, where the program reaches". `docs/` is
admitted for **page names** and `§ N` cross-references, not for identifiers.

That gap is what let `docs/CHAIN-AUTHORING.md` go on naming `parsePending`
(three sites) and `composePendingList` (one) after the ledger became a
directory — neither is exported, and `parsePending` is also the name the CI
consumer-smoke heredoc destructured, which is the red posix lane this tick
drained. The page names the removed API in prose the suite never reads.

The page arguably already authorizes the widening — "A page under `docs/` or
the README that states what a shipped interface does ... may be pinned for
what it says against the interface it describes", and "A class this predicate
admits and the suite does not yet resolve is a plan entry, not a question."
It is a question rather than an entry because **the first red is unbounded
and its size is the decision**: `docs/` is ~400kB across the authoring page,
the CLI page, ten migration guides and five consumer surveys, and every
migration guide names retired exports *on purpose*.

Forks, cheapest first:

- **Call forms only** — resolve a backticked `` `name(` `` against the
  package's exports. Catches all four sites above. Noise: chain-local helpers
  the pages backtick with parens (`groomAgent(`, a consumer's own function),
  each needing a declared exemption.
- **Named pages only** — admit identifiers on the pages that state what a
  shipped interface does (`docs/CHAIN-AUTHORING.md`, `docs/CLI.md`,
  `README.md`) and leave `docs/MIGRATING-*.md` and `docs/surveys/` out by
  construction, since a migration guide's job is naming what is gone.
  Smallest first red, and the exclusion is a rule someone must maintain.
- **Leave it** — accept that `docs/` identifiers rot, and let the CI
  consumer-smoke be the only detector. That is what happened, and the
  detector fired in a lane no tick reads, eight days after the rename.

`THE-AUTHORING-PAGE-STATES-RETIRED-CLAIMS` corrects the four sites
regardless; this decides whether the class can recur.
