# docs/ names the harness package nowhere

Measured this tick: `grep -c 'flume/harness\|flume-harness' docs/*.md` is 0
across all eight pages. The README now leads on `npx flume-harness init` and
the `@dtmd/flume/harness` subpath, but every link it hands a reader onward
lands on engine-only prose:

- `docs/CLI.md` documents the `flume` verb set per-verb and never mentions
  the second bin the package ships, so `flume-harness init`'s refusals and
  exit codes are documented nowhere a consumer looks.
- `docs/CHAIN-AUTHORING.md` is entirely the hand-written-chain path. Nothing
  documents the declaration's fields (`specLocus`, `fence`, `runner`,
  `slices`, `sweep`) beyond the skeleton's own comments, so a consumer
  filling in the placeholders `init` wrote has only `spec/harness.md` — the
  contract, not a guide.
- The three `docs/MIGRATING-*.md` pages predate the package; *Adoption and
  upgrade* says an upgrade is a version bump plus the release's migration
  note, and no page carries a harness-side note.

Same finding shape as the drained inbox item, one layer down: the README was
the entry point, docs/ is the rest of it.
