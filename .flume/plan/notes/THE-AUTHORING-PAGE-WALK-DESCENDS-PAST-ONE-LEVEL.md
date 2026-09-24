# The subfield walk now recurses; the schema's floor is level three

The walk in `tests/harnessDeclaration.test.ts` returns a key's own name plus
everything beneath it, so depth is no longer a special case. Measured on this
tree: shallow yielded 27 names, deep yields 29 — the only addition is
`posturePages`, and `domain` merely moves from `slots` to also being
`slices.sweep.domain`. Nothing in `DeclarationSchema` nests past level three
today, so the recursion is insurance rather than reach.

Two things the next plan tick may want:

1. `slots.domain` and `slices.sweep.domain` are one string in the judged set.
   The walk is name-keyed, so a page naming either satisfies both — `domain`
   was green by collision before this entry and still is. A walk keyed by
   dotted path (`slices.sweep.domain`) would close that, at the cost of every
   page span needing the qualified spelling, which is not how the page reads.
   Filed as an observation, not a defect: no key is currently hidden by it.

2. The phase-keyed skip now sits inside a recursion. It still reads the whole
   key set at a level and descends past it when every key is a phase, which
   holds at any depth; no phase-keyed level exists below level one today, so
   that arm is exercised only where it always was (`fence`, `gates`,
   `agents`, `handoff`).

The page's `slices` bullet now names `domain` and `posturePages` with the
conditional the schema's `superRefine` enforces — required while `plan-sweep`
is enabled, refused where it is not.
