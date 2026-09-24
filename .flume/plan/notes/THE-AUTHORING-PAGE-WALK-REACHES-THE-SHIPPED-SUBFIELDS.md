# The subfield walk is page-whole, and stops one level down

Two scopes, deliberately different, in `tests/harnessDeclaration.test.ts`:

- The **top-level** walk still cuts the declaration list. That list is the
  top level's one home, and the page names the engine-level `Chain` fields
  for two thousand lines, so a page-whole read there passes over a list
  naming none of them.
- The **subfield** walk reads the page whole. A subfield has no single home
  and wants none: gate components belong where gates are documented, the
  supervisor knobs where the page walks the engine policy the declaration
  passes through whole. Demanding a second copy inside the declaration list
  would be the restatement this page's other walks already refuse. Measured:
  section-cut would red 20 of 26, 9 of them supervisor knobs the page
  already walks correctly elsewhere.

The 11 the widened walk red are now named in the declaration list itself:
`kind`/`name`/`command`/`path` on the gates bullet, `directories`/`restore`/
`serialize`, `enabled`/`sweep`, `autonomy`/`domain`, `workflow`/`job`.

**One level, not all of them.** `slices.sweep.domain` and
`slices.sweep.posturePages` sit two levels down and are still named nowhere
the suite reads — the acceptance said "the level beneath", so they were left.
`sweep` is the only field with a third level today; if plan wants it, the
descent is a two-line change (recurse rather than return the keys), and
`posturePages` is the one name it would red.

Every added span is a single lowercase word, so none reaches the interface
pages' identifier scan (`isDeclarationSubject` refuses a lone lowercase
word). A camelCase subfield added to the schema later will reach it and must
resolve against `packageSurface`.
