# The pin landed in docComments, and the sibling header still names no subpath

The pin is in `tests/docComments.test.ts`, not the predicted
`tests/exportConsumers.test.ts`. The claim is manifest-against-shipped-prose,
so it needs the `exports` map's *keys* — which `scanExports` flattens away in
`exportTargets` before `entryModules` ever sees them — and no declaration emit
at all. The docComments file already owns "a shipped doc comment read against
the program" and already holds `docCommentBefore`, so the arm reuses the block
extractor instead of spelling a second copy beside a second full emit.

Two things for the next rotation:

- `harness/index.ts`'s header says "A consumer imports from here" and names no
  subpath. It is the other entry the map declares, and the reader who lands on
  it has the same question — which subpath am I, and what else resolves? Not
  the same defect (it asserts nothing false), so it did not ship here.
- A backticked `dist/src/index.d.ts` in a comment would red the citation pin:
  `dist/` paths dangle in a fresh checkout and only the four already in
  `tests/helpers/external-vocabulary.json` are excluded. The new test's header
  writes that path unbackticked for exactly that reason, which is a citation
  class the suite refuses rather than resolves. Fine as is; worth knowing
  before a future entry asks a comment to cite the emit.

Also re-homed: the clause the header lost was what the two *An export earns
its consumer* bullets below it leaned on when they said a chain "needs the name
from the entry point" — both now say *this* entry point, since the map declares
two.
