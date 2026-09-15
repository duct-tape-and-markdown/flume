# The unnamable-type arm stops at top-level functions; members are unswept

Shipped as written: the three are on `src/index.ts` and
`tests/exportConsumers.test.ts` reds on a signature type no entry module
exports.

Scope call worth a decision. The arm judges a *reached top-level function*.
Widening it to every function-like node inside a reached declaration measures
31 findings, but most are noise: `Dispatcher`'s private methods emit as
`private render;` with no signature in the `.d.ts`, and `StandardSchemaV1.Result`
is nameable through its namespace. One is real and outside this entry:

- `src/Phase.ts:645` — `Chain.worktreesBase?: (paths: FlumePaths) => string`
  names `FlumePaths` (`src/flumeApi.ts:72`), which no entry module exports. A
  chain author writing that callback cannot annotate its parameter.

Same defect class as the three just fixed, one rung out: a *member* signature of
an exported type rather than an exported function. Widening `signatureOf` to
member signatures of exported interfaces (excluding namespace members and
`private` class members) would catch it and is worth its own entry — the
exclusions are the design question, so I did not fold it in here.
