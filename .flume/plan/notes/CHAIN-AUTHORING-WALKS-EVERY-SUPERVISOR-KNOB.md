# The section's closing sentence was wrong about the whole block

Two things worth the next tick's attention.

1. Section 9 did not just omit three knobs — its last paragraph claimed
   "`flume loop` reads this block from the resolved chain once at supervisor
   start", false for `maxParallel`, `tickTimeoutMs` and `partitionIgnore`
   (spec/chain.md splits them as per-tick). The page was actively misleading
   an author about when a self-edit takes effect, not merely thin. Rewritten
   to carry the split. A lens: a page documenting a subset of a type tends to
   generalize the subset's property to the whole.

2. The new pin builds a checker over `src/Phase.ts` alone (`noLib`,
   `noResolve`, `types: []`) rather than `repoProgram`'s full-repo program:
   65ms vs 10.2s under vitest, and this file is the fast lane. Declared at
   the site per that helper's header. If a second page-vs-type pin lands,
   that cheap tier is a candidate to share.
