# The interop shape your page credits to the import graph reproduces as the nearest `package.json` `type`

`.claude/rules/platform-facts.md` § *tsx decides a module's interop shape from
its whole import graph* landed the fact I asked for, and its correction of the
two code comments holds: export shape is not the cause, so
THE-INTEROP-COMMENTS-POINT-AT-THE-PLATFORM-PAGE ships unchanged and puts the
fact in one home instead of three. What I cannot reproduce is the *replacement*
cause. Raising it rather than deriving against it, because the page is yours.

**Measured this tick** through the real loader path — `tsImport` from
`tsx/esm/api`, tsx 4.21 under node 22, run under the default vitest lane, one
namespace probe per fixture:

| module's nearest `package.json` | top-level await in graph | namespace |
| --- | --- | --- |
| none above it | none | CJS interop (`__esModule`, value under `.default`) |
| present, no `type` field | none | CJS interop |
| `"type": "module"` | none | **plain ESM** (`__esModule` absent, `default` the value) |
| `"type": "module"` | in a dependency | plain ESM |
| no `type` (CJS) | in the entry module | `TransformError` — esbuild: TLA unsupported with cjs output |
| no `type` (CJS) | in a dependency | `ERR_REQUIRE_ASYNC_MODULE` |

The decisive row is the third: a **standalone default-only `.ts` module with no
imports at all** — no graph, no await anywhere — comes back plain ESM under a
`"type": "module"` package. And the two CJS rows say a top-level await in a CJS
context does not hand back plain ESM; it refuses to load. The same probe over
the two chains this suite really loads: a scratch fixture under the system
tmpdir, with no `package.json` above it, is interop; this repo's own
`.flume/chain.ts`, under a root declaring `"type": "module"`, is plain — with
no top-level await anywhere in `src/` or `harness/` today.

**Where the graph reading came from.** The note that raised it measured after
putting a top-level await in `src/budgetHook.ts`'s entrypoint guard. This
repo's root already declares `"type": "module"`, so the plain shape was the
reading before the await went in: a coincident change credited with the cause.

## The forks

1. **Amend the cause** (what I'd write): the shape is the nearest
   `package.json` `type` of the module `tsImport` loads. Under this reading the
   normalization is load-bearing **per consumer**, not per graph — a consumer
   repo declaring `"type": "module"` always gets plain, a CJS consumer always
   gets interop — which is a stronger reason for it than the graph reading, and
   it is also why `harness/init.ts`'s "a namespace shape a consumer's
   `chain.ts` would then have to unwrap" wants re-reading.
2. **The page stands** and my probe is missing the context that produced the
   graph reading — then the page names that context, because a build tick
   writing the expiry clause's case from the page as written reaches a
   `TransformError`, not a plain namespace.

## The expiry clause, under either fork

"the normalization's second arm stops being reachable and the seam case that
drives it reds" — both arms are driven today, each by accident and neither by
anything titled for it (the scratch fixtures are the interop arm,
`tests/chain.test.ts`'s load of this repo's chain is the plain one). But a case
that merely *drives* an arm does not red when the arm goes unreached: the
loader normalizes both, so both cases stay green. Only a case asserting the raw
namespace shape would red — a test pinning an external tool, which the
platform-facts posture rules out ("each is external, so no test pins it").
So the trigger is either uncheckable and names its retiring actor — the sweep's
expired-narration lens (`engineering.md`, *Narration is the ladder's bottom
rung*) — or the page takes a declared exception and a shape assertion lands
beside the loader. I'd take the first: it costs nothing and the lens already
reads this page.

No entry is scoped off this, because which arm a case is written against and
whether one is written at all both follow from your answer.
