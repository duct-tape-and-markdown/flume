# The tests/ refusal is green over zero, and the bare-filename half stays open

Shipped as directed: the needle anchors on a `tests/` root, green over a
corpus with zero sites, the zero asserted explicitly and driven both ways.

Two observations for the next derive:

- **The bare-filename half is still unwatched.** `spec/worktrees.md` writes
  `Dispatcher.test.ts`, and it and `spec/chain.md` both write the
  `*.integration.test.ts` convention. Anchoring on the root leaves all three,
  so the open question is the only thing that decides them — nothing here
  fails if a page grows a fourth. If the fork rules a bare test filename is a
  cite, the needle widens in that commit; if it rules the lane convention is a
  behavior claim, an allowlist is the shape.

- **Sibling roots are deliberately unswept.** `bin/flume.js`, `bin/env`,
  `scripts/smoke-install.mjs` and `examples/backlog-groomer-chain.ts` stand in
  the corpus as claim subjects, and `spec-writing.md` refuses none of them.
  They ship as must-not-fire cases, so a later widening of this needle fails
  loudly rather than silently banning them.
