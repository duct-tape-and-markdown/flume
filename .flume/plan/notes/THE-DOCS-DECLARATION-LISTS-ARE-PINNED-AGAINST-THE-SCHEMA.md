# The spec's declaration table is ahead of DeclarationSchema by four fields

Shipped: both pages cut by `sectionOf` and read against
`DeclarationSchema.shape`. `docs/CHAIN-AUTHORING.md` already named all 16
(pin green on base); `docs/LAYERS.md` named 6 and was rewritten.

Observed while cutting: `spec/harness.md`, *What a consumer declares* lists
`jobs`, `friction` and `findings` as declaration fields, and gives `setup` a
`serialize` knob. None of the four is in `DeclarationSchema`
(`harness/declaration.ts`) — 16 fields there, 19 rows plus a knob in the
table. Per CLAUDE.md a spec section that no longer matches `src/` is a defect
in one of them, so this is four entries' worth of work or a spec correction,
not drift the pin sees.

The pin is one-directional by design: schema fields ⊆ what the page names.
It cannot see a page naming a field the schema lacks, which is exactly the
state both pages are in today (`jobs` is named on both). If plan wants that
direction caught, it needs its own entry — and it would red today until the
four fields land.
