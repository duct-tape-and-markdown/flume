# The flag ships; two sites downstream of it stayed put

**Expired narration, spec locus.** `.claude/rules/platform-facts.md`, *A
headless `claude -p` inherits the user's MCP servers*, closes with "Whether
the engine passes it by default is an open engine question; until it does, a
chain passes it in `extraArgs`." Both clauses fired with this commit. Build
cannot edit the rules locus; the sweep's expired-narration lens will keep
re-finding it until a human retires those two sentences.

**Harness declaration does not expose the knob.** `harness/declaration.ts`
`agents: byPhase({ model, extraArgs })` types only those two, so a consumer
declaring the harness package cannot say `inheritUserMcp`. Deliberate and
scoped out here: the package's default (strict) is what flume wants, and a
consumer that genuinely needs inheritance has no declared way to ask. Plan's
call whether that is a missing surface or correctly withheld opinion.
