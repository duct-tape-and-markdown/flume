# The error-class values ride `api` alone, and two loaders ride the entry point

Shipped as filed: `PromptTemplateUnreadableError` is now
`FlumeApi.PromptTemplateUnreadableError`, `src/index.ts` names the type, and
`docs/CHAIN-AUTHORING.md` §5's preamble names the class beside the loader it
hands out.

Observed while placing it. `src/index.ts` states one rule for every error
class: "the value rides `FlumeApi.X`; only the type is named here". But
`renderPrompt` and `readPhaseTemplate` are *value* exports at the entry point.
So a consumer that imports either from `"flume"` outside a chain factory — a
script, a downstream test — has no `api` object, and therefore no value to
`instanceof` against for any of the six classes. The gap this entry closed on
the `api` surface is still open on the entry-point surface, for the render
refusals as much as for this one.

Two ways out, and it is a decision, not a fix: either the entry point stops
exporting render helpers as values (they are only reachable through `api`
anyway, which is the rule the comments already state), or the classes'
*values* join them there. Filing it as an engine entry either way would need a
ruling first; I did not widen scope here.

Smaller thing: `runChainProbe` (`tests/Dispatcher.test.ts`) hardcoded a
`renderPrompt` call as the attempt it drove every chain probe through. It now
takes the attempt as a parameter, so the three probes share the temp-config
and factory-stash sequence and differ only in what the chain reaches for. No
behavior moved.

Also: the class is deliberately not a `RenderRefusal` (`src/Prompt.ts` says
why), and the new probe pins that direction — `isRefusal` is asserted false,
so a later commit folding it under the base reds rather than passing.
