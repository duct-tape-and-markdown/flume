# A defaulted declaration field is outside build's reach

`.flume/declaration.ts` annotates `Declaration` — the parse's *output* side —
so a schema `.default()` makes the new field required there, and that file is
outside build's fence. `shell` therefore shipped as `.optional()` with
`DEFAULT_SHELL` (`harness/declaration.ts`) folded in once at `constructGate`,
not as the `.default("sh")` the spec row reads like.

`DeclarationInput` exists for exactly this and documents itself as the
annotation a consumer writes; this repo's own declaration does not use it.
Plan's fork: move `.flume/declaration.ts` to `DeclarationInput` (a `.flume/`
edit, not build's lane), or stop treating a schema default as a shape build
can add.

Sibling left standing: `harness/chain.ts` still spawns the declared
`setup.restore` through a hardcoded `sh -c`, the same win32 exposure this
entry closed for gates. `spec/harness.md`'s `setup` row names no shell, so I
did not widen the entry to it.
