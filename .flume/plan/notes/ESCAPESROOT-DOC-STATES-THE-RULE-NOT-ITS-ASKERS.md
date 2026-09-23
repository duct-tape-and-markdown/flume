# The trim stranded nothing; computeStateRootRel carries the same registry

`harness/scriptRunner.ts` needed no edit: the entry's conditional ("takes the
escapesRoot cite if the trim strands readLine's only one") is false on this
tree. Every asker the deleted list named already states, at its own decision
point, that it asks `escapesRoot` and why a prefix test would be wrong there:
`readLine`'s body comment (`harness/scriptRunner.ts`), `baseTree`'s selection
loop (`harness/toolRun.ts`), `isPendingRelocated`'s doc
(`src/pendingLedger.ts`), `assertStateRootRelative` (`src/paths.ts`). The
`computeStateRootRel` leg is a sibling in the same file with its own doc. The
shrink re-homed no cite; the sites already owned the fact. `readLine` being
cited nowhere now is not a loss -- a module-private function needs no citation.

Debt, same section, out of this entry's scope: `computeStateRootRel`'s doc
(`src/paths.ts`, directly below `escapesRoot`) carries the identical shape --
a hand-kept enumeration of its consumers (the dispatcher, `harvestFriction`,
the `afterCommit` gate-context build's `configDir` call, the ledger). Same
defect under *Derived state is computed...*: who calls it is the program's
answer. One difference makes it a real edit rather than a deletion -- the
`configDir` leg documents a second-root call whose rebase rule ("rebasing it
onto the worktree only when it resolves inside the repo") is stated nowhere
else, so a trim must re-home that rule at the gate-context build first. Worth
its own entry.

No `tests[]`/`pins[]`: the change deletes prose no suite read, and
`tests/commentCitations.test.ts` already covers what survives. Full suite
green, 1692 passed.
