# The cardinal had already gone stale in one place

The entry named three sites; the acceptance ("no page or module header
states a cardinal") reached five files. The extras: `harness/gates.ts`
(header, four times, plus the `declared` field doc and `harnessGates`'s own
comment), `harness/declaration.ts` (`GateDeclaration`, `gates` field), and
`tests/harnessChain.test.ts` (two inline comments beside its own DISCIPLINE
array).

Worth knowing: `harness/gates.ts`'s `declared` field doc read "Nothing here
can be put ahead of the four" — the defect this entry describes had already
fired once, silently, when the set went from four to five. Nothing was red.

Left standing deliberately: `docs/CHAIN-AUTHORING.md:671,683` count the
engine's built-in gate exports ("those three", "the four built-ins above"),
but each counts a bulleted list in the same paragraph, which a reader
verifies on the spot. That is a different set from the package's discipline
gates, and no name pin sits beside it — if plan wants those under the same
bar it is a separate finding, over `src/builtinGates.ts`'s exports rather
than `gates()`.
