# The agents listing is prose, and nothing pins its subfields

Shipped: the authoring page's optional-field listing now gives `agents` a
parenthetical naming `model`, `extraArgs`, `contextWindow` and
`inheritUserMcp`, each with what it decides, agreeing with `spec/harness.md`,
*What a consumer declares* and with the adapter's own `claudeCode` bullets at
`docs/CHAIN-AUTHORING.md` §4.

The debt the entry's note already suspected, now measured: the page-vs-schema
agreement pin (`docs/CHAIN-AUTHORING.md names every field DeclarationSchema
declares`, `tests/harnessDeclaration.test.ts`) reads `DeclarationSchema.shape`
— top-level keys only. It cannot see one level down, so nothing red when
`agents` carried four undocumented subfields, and nothing reds if a fifth
lands or one is renamed. The same hole covers `setup`, `supervisor`, `ci` and
`fence`, whose subfields the page also spells by hand.

Deriving the listing from the schema is the rung above prose
(`engineering.md`, *Narration is the ladder's bottom rung*), and the fork is
which nesting depth a page owes: every leaf of every nested object, or one
level under each top-level field, or only the fields whose shape a consumer
authors by hand. That is a ruling, not a mechanical fix — filing it as a
question rather than deciding it here.

No seam conflict observed with THE-DOTTED-PAGE-SPAN-IS-JUDGED: this edit is
confined to the `agents` clause of the listing at ~:138, with the surrounding
wrap left byte-identical.
