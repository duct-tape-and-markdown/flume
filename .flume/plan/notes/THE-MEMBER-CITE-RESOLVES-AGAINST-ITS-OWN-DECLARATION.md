# The member arm found eight sites, one of them a deliberate retired cite

Plan measured four spellings over five sites; the arm reds eight. Beyond the
entry's list: `Dispatcher.runGate` twice more (`tests/harnessRunner.test.ts`,
`tests/worktrees.test.ts` — all three now `runGate` (`src/gateRun.ts`), the
pair arm), and `Chain.seedDir` (`tests/chain.test.ts`).

`Chain.seedDir` is the one worth a decision. That comment's whole subject is
that the field was *removed* from the chain surface, so no member arm can ever
answer it — and the repo-wide set answered it only because the test body spells
`"seedDir"` as a literal, which is the exact vacuity this entry closes. I
respelled it as the key the fixture writes, `` `"seedDir"` ``, which the subject
rule declines, and said at the site why. If plan wants retired surface cited by
name in prose, that wants its own mechanism (a declared exception arm, or an
`external-vocabulary.json` reason distinct from "something outside owns it") —
the quoted-key dodge works but it is a spelling trick, not a rule.

Two readings the arm needed that the entry did not name, both measured, both
false reds without them:

- **A merged namespace's exports.** `StandardSchemaV1.Result`
  (`tests/helpers/exportGraph.ts:291`) is a type of the `declare namespace`
  beside the interface; neither the declared type's nor the value side's
  properties reach it, so the arm reads `sym.exports` too.
- **A union's variants, unioned.** The checker's own property reading over a
  union is the *intersection*, which would red a cite naming a field one
  variant carries. Pinned by `Span.spanTag`/`Span.spanReason` in the fixture.

Scope left open on purpose: the arm fires on two segments only. `a.b.c` walks a
chain of types, and holding every segment to the head's members would red the
second hop. No drift was measured in that class, so per the carve-out's own
rule it stays unresolved rather than shipping an arm nothing found a red for.
