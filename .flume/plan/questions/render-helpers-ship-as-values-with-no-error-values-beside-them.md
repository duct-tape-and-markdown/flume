# `renderPrompt` and `readPhaseTemplate` ship from `"flume"` as values, and no refusal class does

`src/index.ts` states one rule for every error class it names: *the value rides
`FlumeApi.X`; only the type is named here* (`:162`, `:165`, `:170`). That rule
holds for a chain factory, which is handed an `api`. It does not hold for the
two render helpers beside those lines: `renderPrompt` and `readPhaseTemplate`
are **value** exports at `:155` and `:159`.

So a consumer that imports either from `"flume"` outside a factory — a script,
a downstream test, a tool that renders a prompt to inspect it — can call them
and cannot `instanceof` anything they throw. `buildFlumeApi` is not exported
from the entry point either (`src/index.ts:194` names only the `FlumeApi` and
`FlumeApiPaths` types), so there is no way to reach an `api` value from
outside a chain. The gap is the whole render-refusal family —
`RenderRefusal`, `InlineExecRenderError`, `PromptTemplateUnreadableError` —
not one class.

Raised from `A-CHAIN-NAMES-THE-CLASS-AN-UNREADABLE-PROMPT-REFUSES-WITH`'s
build note, which closed the `api`-surface half and named this one as needing
a ruling before it could be scoped. Verified on the tree this tick.

## The fork

- **(a) The entry point stops exporting the render helpers as values.** That
  is the rule those comments already state, applied consistently: everything
  reachable at `"flume"` is a type, everything callable rides `api`. Costs: a
  breaking change for any consumer importing them today, and it asserts that
  rendering outside a chain is not a supported use — which may be true, but
  nothing says so.
- **(b) The refusal classes' values join them at the entry point.** Keeps the
  helpers callable standalone and makes their refusals catchable. Costs: the
  one-rule-for-every-class comment stops being one rule — a class exported as
  a value because a sibling helper is, and the rest by `api` alone — so
  whatever replaces it has to say which classes and why.
- **(c) Export `buildFlumeApi`.** A standalone consumer builds its own `api`
  and everything is reachable through the rule as written. Costs: `api` is
  the chain-factory surface, and handing it to anyone who can name a path
  widens what the engine promises a consumer well past the render seam.

**Which is right turns on a question the spec has not answered: is calling
`renderPrompt` from outside a chain a supported use?** If yes, (b) is the
smallest honest move and its comment rewrite is the work. If no, (a) is, and
the entry point loses two exports. (c) answers it by widening the surface
rather than deciding, which is why it reads last here.
