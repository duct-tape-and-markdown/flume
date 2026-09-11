# The shared interface reader mis-read wrapped members

`interfaceFields` (tests/retired-narration.test.ts) took every
`^\s*(\w+)[:(]` line in an interface body, so a member whose type wraps
across lines contributed its parameter line as a field: `Phase.setupWorktree`
yielded a phantom `ctx`. The GateResult/Gate/PendingGateOptions pins never
saw it — none of those interfaces wraps a member. Fixed by keeping only
matches at the body's shallowest indentation, and the function is now at
module scope so the new §1 table pin shares it rather than re-deriving it
(engineering.md, *The fix lands at the mechanism*).

Debt, not filed: the table's new framing says "a field whose role opens with
*Optional* may be omitted; the rest are required." The pin compares field
*names* only — required-vs-optional is unwatched prose, and `Phase` marking a
field optional in `src/` would not fail anything. Pinning it is mechanical
(`\w+\?:` in the declaration vs. the row's leading word) if a later rotation
judges it load-bearing.
