# The declared `resolver` has no row in the spec's declaration table

Shipped `resolver` as a twelfth declaration field. Without it nothing could
supply a `SectionResolver`: the package's own `per` gate is the only caller of
`resolveCite`, so the type would have been unreachable surface and "a consumer
may declare a resolver" unshipped. `spec/harness.md`, *What a consumer
declares* names it in prose — "two of its fields are values with behavior (the
runner and the resolver)" — but its table lists eleven rows and no `resolver`.
The field's doc comment points at that prose rather than the table; the row is
a human's to add, or the field is a human's to reject.

Also: `.flume/chain.ts` still carries `perResolvesGate` and `sectionOf`. The
package now holds the one grammar (heading match, declared resolver, injected
at-ref reader, one verdict shape). The chain copy retires at the factory
cutover — build cannot write `.flume/chain.ts`, so it could not go here.
