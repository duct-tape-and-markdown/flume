# DEFAULT_SHELL's only non-test reader moved into the schema

The fold landed in `harness/declaration.ts` itself, so `DEFAULT_SHELL`'s
lone runtime reader (`runnableShell`, `harness/declaredShell.ts`) is gone:
the constant is now consumed inside its own module by the schema, plus two
test files that name the default rather than respelling `"sh"`. That still
earns the export under *An export earns its consumer* (a test counts), but
a sweep tick reading it cold may file it as scaffolding - it is not.

Nothing else moved. `constructGate`/`shellCommand` (`harness/declaredGates.ts`)
and `installing` (`harness/chain.ts`) took `string` in place of
`string | undefined` with no call-site change, and the chain cases that
already claimed to exercise "the schema's own default" now do.
