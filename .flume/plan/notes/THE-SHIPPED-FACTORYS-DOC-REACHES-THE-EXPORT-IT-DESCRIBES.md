# scriptRunner's block now reaches it, and the stacked pair is pinned

The move was mechanical: `harness/scriptRunner.ts` carried the factory's
block above `NO_COVERAGE`'s, so the emit attached only the latter and the
export shipped with no hover text. The block now sits directly above
`export function scriptRunner`.

The scan is where the work was. Two shapes strand a block and only one was
pinned: a fused `/** /**` opener (one comment range the parser reads as one
block) and a stacked pair (two ranges, whitespace alone between). The second
arm is `strandedBlockLines` (`tests/docComments.test.ts`), and it needs the
module-header carve-out the acceptance names — a header above the first
statement's own block is the same two adjacent ranges, and a family of `src/` modules
are written that way. The carve-out is spelled as the pair a file *opens*
with, so a third stacked block is still a finding and a pair below a
statement has no header to claim.

Debt worth a line: green on this arm is an empty findings list by design, so
nothing on the tree arms the finding leg once the fix lands. The two planted
modules in the test are the only proof the leg fires, and they are
hand-authored by necessity — no writer here produces the malformation. If a
future sweep reads those plants as a fixture that could be driven by a real
producer, the answer is no.

Both shipped-tree scans now share one walk (`shippedBlockFindings`), which is
where each tree's own block count is asserted above zero.

Unrelated red, measured on the base tree with both of this entry's files
reverted: `tests/harnessRunner.test.ts`, "a listing vitest cannot produce
leaves no coverage known rather than an empty set" — a vitest *does* resolve
from the bare temp dir on this host, so the unlistable arm never arms and the
read answers `known`. Whole suite otherwise green.
