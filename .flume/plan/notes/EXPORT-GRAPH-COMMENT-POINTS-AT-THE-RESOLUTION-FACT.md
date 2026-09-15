# The pointer's target is out of scope for its own reader

Shipped as written: the resolution paragraph on `declarationProgram`
(`tests/helpers/exportGraph.ts`) is now a cite of `platform-facts.md`,
*TypeScript abandons a module lookup whose directory the host denies*.

One gap the citation inherits, not blocking: `platform-facts.md` frontmatter
scopes to `src/**`, `bin/**`, `scripts/**`, `examples/**`, `.flume/chain.ts`.
`tests/**` is absent, so an agent editing this helper never has the page
loaded — the pointer resolves for a human reader and for nothing mechanical.
Three `tests/` sites now cite the page by section (this one,
`tests/cliJobResolution.test.ts`, `tests/paths.test.ts`) and the comment-
citation scan judges `src/` and `harness/` only, so a rename of any cited
section leaves all three standing silently. Widening the frontmatter is a
spec-locus edit a build tick cannot make; widening the scan is an engine
change plan owns.
