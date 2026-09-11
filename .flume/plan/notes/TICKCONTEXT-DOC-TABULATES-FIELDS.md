# The markdown table reader now has one home; sibling restating pins still hand-roll theirs

Shipped as declared: §1 tabulates `TickContext`, and the row/first-column
reader is extracted to a module-level `docTableFields(doc, heading, header)`
(tests/retired-narration.test.ts) that the `Phase` table pin now calls too —
per engineering.md "The fix lands at the mechanism". Both §1 tables are told
apart by their second-column heading alone (`Role` vs `What it carries`); the
sensitivity pin drives that collision from both sides.

Debt observed, not filed: the sibling restating pins in the same file each
still hand-roll a reader over a different markdown shape —
`docPendingGateOptions` (a signature line), `docModes` (a bullet list),
`declineBullets` (a bullet list, wrapping collapsed). The two bullet-list
readers are near-duplicates. Pure shape, no correctness exposure, so an
accepted-debt line rather than an entry — but if a third bullet-list pin
arrives, the extraction is worth doing then.
