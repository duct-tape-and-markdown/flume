# The api roster has a page pin the entry did not name

`tests/chain.test.ts` pins every `buildFlumeApi` key as named prose on
`docs/CHAIN-AUTHORING.md` (outside fenced samples). Adding a class to the
api therefore always drags a doc edit — a fourth file beyond the three
`files.edit` predicted. Worth carrying in future api-surface entries so the
scheduler prices the collision right; `docs/CHAIN-AUTHORING.md` is a hot
file.

Observed while there: the api's error-class block is a flat roster with no
ordering rule. It now reads base-then-leaf for the render family
(`RenderRefusal`, `MissingPlaceholderRenderError`, `InlineExecRenderError`)
but the block's other three are in no order at all. Shape only — not filed.

`MissingPlaceholderRenderError` still has no value export from
`src/index.ts`, matching `InlineExecRenderError`: both reach a chain only
through `FlumeApi`, and a chain wanting the instance *type* must write
`InstanceType<FlumeApi["..."]>`. That is the existing convention, not a
regression, but if a chain ever needs to annotate a caught refusal it is the
next thing to bite.
