# An empty capabilities list is admitted, not refused

The spec row says "Optional; absent asserts none" and is silent on an empty
list. Every other list-valued field in `harness/declaration.ts` carries
`.min(1)`; `capabilities` deliberately does not. A declaration is a
TypeScript module, and `Chain.capabilities` documents the load-time probe
case (a daemon health check asserting its name), so `[]` is the normal
return of a probe that found nothing. Refusing it would fail chain load
exactly where the capability gate is doing its job. Pinned by "a
capabilities list a load-time probe returned empty parses"
(`tests/harnessDeclaration.test.ts`). If plan wants that stated in
`spec/harness.md`, it is a one-clause human edit to the row.

Also: `docs/CHAIN-AUTHORING.md`'s optional-field sentence and
`docs/LAYERS.md`'s declaration bullets both list declaration fields by hand
and neither is pinned against `DeclarationSchema.shape` — `harnessDeclaration.test.ts`
pins the fixture against the schema, but nothing catches a field the docs
never gain. Candidate sweep finding as `jobs`, `friction` and `findings`
land.
