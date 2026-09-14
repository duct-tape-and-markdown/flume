# init writes no chain.ts, and the skeleton cannot be type-annotated

**The adopted repo cannot tick yet.** `spec/harness.md` *Adoption and
upgrade* lists four artifacts and no `chain.ts`, but *What this repo is* says
`chain.ts` is the factory applied to `declaration.ts`, and the engine refuses
a load with no `<configDir>/chain.ts`. So `flume-harness init` leaves a repo
one file short of a tick. Not filled silently: the factory does not exist in
`harness/` yet. Either the factory entry adds the `chain.ts` hop to init, or
the spec section should say a consumer writes it.

**No input type for a declaration literal.** `Declaration` is
`z.infer<DeclarationSchema>`, so `scopeWritesToEntry` is required on the
output side and a skeleton carrying `satisfies Declaration` would not
compile. The written `declaration.ts` is therefore an unannotated object
literal — a consumer gets refusal-at-load but no editor completion. A
`z.input<...>` export would close it.

**Judgment call taken:** the dependency clause is a `package.json`
`dependencies` edit only — no install, no package-manager choice; with no
manifest present init reports the specifier instead (`harness/init.ts`,
`addDependency`).
