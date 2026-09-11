# The spec/ half is still two cites red — under a shape the first scan missed

Shipped: 50 cites read across `src/`+`examples/` (49 parenthesized, 1 colon,
6 dotted), 3 repointed. Grammar is three shapes, not two — the comma variant
(``` `sym`, `src/x.ts` ```) and the module-first one
(``` (`src/x.ts`, `git.readFileAtRef`) ```) carry real cites, including
`src/cli.ts:686`, which the colon+paren reading would have missed.

Two things for the next derive:

1. **`spec/` is not clean.** 5bfbe71 repointed four, but the same grammar run
   over `spec/` still finds 2 red, both the comma shape the earlier count
   didn't read: `spec/cli.md:177` and `spec/jobs.md:18` say `resolveStateDirs`
   is `src/cli.ts`; it is `src/cliJobResolution.ts`, as `spec/chain.md:195`
   already says. A re-filed SPEC-CITE-MODULE-PATH-PINNED parks again until a
   human fixes those two.
2. **Widening past `src/`+`examples/` buys nothing today.** `docs/`,
   `.claude/rules/` and `.flume/chain.ts` carry 0, 1 and 0 cites under this
   grammar, all green. Scope is where the cites are, not an omission.
