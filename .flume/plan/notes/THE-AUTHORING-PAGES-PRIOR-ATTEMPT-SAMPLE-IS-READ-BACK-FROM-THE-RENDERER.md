# The doc sample needed no normalizing; one value stays coupled, and a second fence reader is still standing

The page's fenced sample already agreed with the renderer lead-for-lead, so
`docs/CHAIN-AUTHORING.md` is untouched. The pin compares line leads — each
unindented block line with its value dropped at the `": "` its label ends in,
indented `indentBlock` bodies dropped whole — as an ordered equality, so a
lead added on either side alone reds. Verified both ways on this tree by
deleting the page's `Gate verdict:` line and by adding a lead to `modeLines`
(`src/Prompt.ts`).

One coupling worth knowing: the anchor line (`Recorded <at>, trunk tip
<sha>.`) labels nothing, so the lead cut has nothing to drop its values at and
the fixture takes the page's own stamps verbatim. Editing the sample's
timestamp or sha reds the pin, which reads as a value pin inside a lead pin.
The alternative was a second hand-authored spelling of the anchor sentence in
the test, which is the vocabulary re-authoring the seam rule warns about. If
that coupling bites, the fix is the renderer reporting the anchor's shape,
not a regex in the suite.

Debt: `fencedBlocks` now lives in `tests/helpers/docSections.ts`, off the same
fence walk `proseLines` uses (one walk now, not two toggles). But
`tests/examples.test.ts` still extracts its `slicePhase` quote with its own
```ts fence regex — a second reading of what a fence is, in the exact family
the docSections header says it exists to end (`.claude/rules/engineering.md`,
*A module is one job*). Shape only, no behavior at stake; noting it rather
than widening this entry.

Also: `sampleRecord` is typed `Required<Omit<GateRevertAttempt,
"blamesSpan">>`, so an optional field the variant gains is a compile error in
the fixture rather than a lead the page silently stops claiming. `gateRevert`
is that record re-anchored, so the maximality guard covers every gate-revert
case in the file.
