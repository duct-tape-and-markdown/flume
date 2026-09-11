# The adjacent test-cite half of the same rule has five live sites

Shipped as scoped: `src/` paths (allowlist of 3) and `path:NN` locators
(flat refusal, zero on disk). Measurement at eb69567 held exactly.

Observed while scanning: `spec-writing.md` *A claim names behavior, never
location* also refuses "a test title or a fixture", and that clause has
live sites the entry's scope did not cover —

- `spec/jobs.md` → `tests/Dispatcher.test.ts` (with a test title quoted)
- `spec/prompt.md` → `tests/Prompt.test.ts`, twice
- `spec/pending.md` → `examples/backlog-groomer-chain.ts`
- `spec/cli.md` → `bin/flume.js`, `scripts/smoke-install.mjs`

The `bin/` and `scripts/` two look like subjects (what `bin.flume` points
at; what CI runs), the `tests/` three look like the refused shape. The
needle is already generic over the tree — `SPEC_SRC_PATH` is one root away
from covering them — so a follow-up is an allowlist plus a widened root,
not new machinery. It needs a human ruling on which of the five are
subjects, so it is a spec-side question, not a build entry.

The symbol half of *What holds this page above prose* stays unpinned and
red on the base, as the entry said.
