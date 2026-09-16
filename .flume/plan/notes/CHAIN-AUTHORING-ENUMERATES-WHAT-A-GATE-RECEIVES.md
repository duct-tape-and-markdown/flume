# The gate-context walk is pinned by name only

Shipped: `docs/CHAIN-AUTHORING.md` §2 gains *What's on `ctx`*, one bullet per
`GateContext` field, pinned as set-equality against the interface resolved off
`src/Gate.ts` (`tests/examples.test.ts`), at the sibling runner-walk pin's tier.

Two things for the next derive:

1. The equality pin buys the *name* of every field, not what each bullet says
   about it. A second case in the same block asserts the stage phrases for
   `baseSha`, `landedOnSha` and `entry` — the three whose availability varies,
   and what a chain guesses wrong about. Other bullets' bodies are unpinned
   prose; a field whose semantics change keeps a green, stale paragraph. Not
   filed: pinning prose bodies against doc comments is prose against prose.
2. `docs/MIGRATING-0.15.md` still carries a `baseSha` passage that now
   duplicates the standing page. Left alone deliberately — a migration page is
   a dated record of one release's port — but the same split recurs at each new
   context field.
