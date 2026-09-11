# The doc's new claim is prose-only until the promotions land

The opening now tells a reader `.flume/chain.ts` is ahead of `examples/`
by construction. Nothing mechanical holds that: no test reads the two and
asserts the relation. Measured gap at this tick — `.flume/chain.ts`
composes `api.git.readFileAtRef`, `api.paths`, `api.slugify`,
`entryChannelPaths` and per-entry `pins[]`; cascade composes none of them.
I kept that list out of the doc (it expires the moment a promotion lands)
and out of a pin (pinning "cascade lacks X" fails green the instant X is
promoted, which is the outcome the follow-up entries want).

Worth plan's judgement: is there a durable form of the claim — e.g. a pin
that `.flume/chain.ts` loads under the same `buildFlumeApi` the examples
test uses, so the living reference is proven loadable rather than only
named? Today `tests/examples.test.ts` reads the three example factories and
never touches `.flume/chain.ts`.
