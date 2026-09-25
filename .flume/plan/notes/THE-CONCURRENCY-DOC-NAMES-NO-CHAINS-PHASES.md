# The vocabulary scan is one registrar now, and one test title retired

`tests/docComments.test.ts` no longer carries the combined case "the shipped
`forkResolver` and `entryChannelPaths` doc comments name no term in the shared
chain-vocabulary list". The scan's one sequence — find the block, prove it is
the block, assert the absence — moved into `itNamesNoChainVocabulary`, which
registers one `it` per subject with a generated title, so the two options now
red under their own names and `Concurrency` sits beside them. Anything that
cites the old title by name (a future `pins[]` line) will not match; the new
spelling is "the shipped `<label>` doc comment names no term in the shared
chain-vocabulary list".

Subjects are named one call apiece rather than gathered into an array: an
empty roster registers zero tests, which no vacuity pin inside a loop can
catch. The glob scan lower in the same file still uses the array shape
(`GLOB_OPTIONS`) and carries a length guard for exactly that reason — two
shapes for one concern in one file, worth a look if the sweep reads it.

`Concurrency` takes a type-alias `decl` (`export type Concurrency\s*=`), which
is why the registrar takes a regex source rather than a field name;
`docCommentFor` stays as the field-shaped caller the other four cases use.

Searched `docs/`, `README.md`, `src/`, `harness/` for the same roster claim
("canonical fanout", "must be singleton") — no other site restates it, so the
doc comment was the only copy. `src/cli.ts:698` still cites `Phase.ts,
"Concurrency"` for the selection fact; that cite survives the rewrite, since
the fanout arm still states that fanout is what picks from the queue.
