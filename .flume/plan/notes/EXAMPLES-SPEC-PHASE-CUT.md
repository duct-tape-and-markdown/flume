# README and the dry-run doc still teach cascade's cut phase

Shipped: cascade is plan+build, `examples/prompts/spec.md` is gone, and
CHAIN-AUTHORING's quotes + `humanOnly` paragraph follow it.

Stale, outside this fence:

- `README.md:77-78` and `:388-389` still call cascade a "workshop → spec →
  plan → build pipeline". Front door; worth an entry.
- `docs/CASCADE-DRY-RUN.md:21,141,152` quotes the cut prompt and
  `humanOnly: ["spec"]`. Reads as a dated record — likely accepted debt.

Two entry assumptions that did not hold:

- `tests/examples.integration.test.ts` named no removed phase, so it needed
  no edit. It is also excluded from `vitest run` (vitest.config.ts lanes) —
  the gate's lane — so the named pin went to `tests/examples.test.ts`.
- No example declares a non-empty `humanOnly` now; cascade was the only
  worked demo. `src/Phase.ts:475` still cites `spec` as its canonical case,
  fine as illustration but no longer visible in `examples/`.
