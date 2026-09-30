# The order drift was one word, and nothing in the tree could have caught it

Shipped: `src/cliHistory.ts:2` now reads "oldest-first". One word; no
behavior, no test moves. `pnpm tsc --noEmit` and the full suite (74 files,
2179 passed) green.

Two facts for the next rotation:

1. The header carried a live cite — `(spec/cli.md, *Subcommand surface*)` —
   and that section states "oldest first" outright (`spec/cli.md:38-40`). So
   the drift sat directly beside the citation that contradicted it, and the
   citation pin still read green, because that pin resolves the page name and
   the section heading as tokens, never the sentence the comment wraps them
   in (`engineering.md`, *Narration is the ladder's bottom rung*). Every body
   of this family so far has been of that shape: a doc comment asserting a
   property of a shipped surface where the surrounding cite resolves and the
   claim is unread. If a fourth arrives, the finding to weigh is not another
   one-word fix but whether a header claiming an order beside a read whose
   own doc states it is a class a pin could reach — the two sides are both in
   `src/`, both reachable from the program, and the vocabulary is a closed
   set ("oldest"/"newest" first).

2. Sole contradicting site, confirmed by a tree-wide search for the
   order vocabulary across `src/ harness/ tests/ docs/ spec/ bin/ examples/
   scripts/ README.md`: `docs/CLI.md:144`, `src/cliHelp.ts:563`,
   `src/tickVerdict.ts:1594`, `docs/CHAIN-AUTHORING.md:2351`,
   `tests/cliVerdict.test.ts:525` and `tests/Dispatcher.test.ts:14330` all
   already said oldest first. Nothing else in the family's neighborhood needs
   a follow-up entry.
