# Two cite scans now, and neither reads docs/

Shipped as specified: `TITLE_CITE_SHAPES` + `resolveTitleCite` beside the
symbol grammar in tests/retired-narration.test.ts, and both
src/loopSupervisor.ts pointers repointed. Corpus is 6 cites over 6 modules
(paths, PendingSchema, Prompt, builtinGates, Dispatcher, loopSupervisor);
only loopSupervisor's was stale, and it was red on the base as predicted.

Two things for the next rotation:

- **Both comment-cite scans are scoped to `src/` + `examples/`
  (`CITE_SCANNED_ROOTS`).** `docs/` is scanned for *release* cites only, so a
  module-path or test-title cite in docs/CHAIN-AUTHORING.md is watched by
  nothing. Same rot, same grammar already written — widening is a file-list
  change, not new machinery. Not filed: I did not verify docs/ carries one.
- **Resolution is substring-of-file, not title-position.** A quoted title that
  appears in a comment inside the named suite would resolve. Tighter means
  parsing `it(…)` argument text; deliberately not built, since the failure
  mode this catches is extraction, and an extraction moves comments with the
  test.
