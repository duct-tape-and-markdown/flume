# Four `spec/` sentences name retired exports, and three trees no identifier arm reaches

From note `THE-AUTHORING-PAGE-STATES-RETIRED-CLAIMS`, re-verified on disk
this tick. Two parts: an edit only a human can make, and the predicate fork
that would stop the class recurring.

## 1. The four sentences (a human edit; `spec/` is your surface)

`parsePending` / `parsePendingLoose` / `composePendingList` were renamed to
`parsePendingQueue` / `parsePendingQueueLoose` / `composePendingEntry` when
the ledger became a directory (`docs/MIGRATING-0.19.md`, the rename table).
The package exports none of the old three. Still standing:

- `spec/cli.md:59` — `check` "the real parse (`parsePending`, …)".
- `spec/pending.md:108` — "`composePendingList` builds the validator".
- `spec/pending.md:130` — "`parsePending` is synchronous and feeds decision
  and rewrite paths".
- `spec/pending.md:526` — "`parsePendingLoose` is a separate core-only
  reader".

Each is a true sentence about a symbol under a name that no longer exists.
`03f16902` corrected every site a build tick could reach; these four are
outside the fence.

## 2. The identifier arm stops three trees short

`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* now
resolves a backticked identifier in `src/`, `harness/`, `tests/` and — as of
`a613be82` — on the three interface pages. The same rot reached three classes
that arm does not cover, each found by hand rather than by the suite:

- **`spec/` itself** — the four sentences above. The page's own carve-out
  reads prose against the program only where the package ships the prose;
  `spec/` is the human's surface, and admitting it would red on every
  human edit rather than on a rename. Is a token still a token here?
- **A comment in `examples/`** — `examples/backlog-groomer-chain.ts` named
  its api destructuring wrongly, twice. `examples/` gets the page-name arm
  and not the identifier arm, and `scanPageCitations`' own doc states why: a
  domain the program does not resolve has no token set to judge against.
  Widening means putting those trees in a program, which is mechanics with a
  cost, not a rule edit alone.
- **A user-facing string literal in `src/`** —
  `AsyncEntryExtensionValidatorError`'s message named `parsePending` after
  the doc comment above it was corrected, so the shrink orphaned the string
  it was covering. The rule puts a literal out by construction ("a literal is
  itself a resolution arm"), which is right for a fixture and wrong for
  refusal text a consumer reads. Is refusal text a fourth interface surface?

Part 1 stands whatever is ruled in part 2. A ruling on any of the three
classes files as a plan entry per that section's own closing line; leaving
one out by construction wants a sentence saying so, since each was found the
expensive way.
