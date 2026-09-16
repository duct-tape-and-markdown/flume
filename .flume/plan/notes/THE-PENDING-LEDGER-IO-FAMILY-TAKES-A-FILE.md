# computeStateRootRel is path machinery still living in Dispatcher.ts

Shipped as written: `src/pendingLedger.ts` holds the strict read, the
tolerant read, the relocation check and the wave's rewrite; `TickLegContext`
extends `PendingLedgerContext` instead of fronting it.

`isPendingRelocated` needed `computeStateRootRel`'s escape check, and
importing it from `src/Dispatcher.ts` would have made a runtime cycle
(Dispatcher imports the ledger for `render`). I folded the predicate into
`escapesRoot` (`src/paths.ts`) instead — it was already spelled a third time
inside `assertStateRootRelative` there, so that is one home, three callers.

What's left: `computeStateRootRel` is pure path arithmetic (`relative` +
`gitPath`) exported from `src/Dispatcher.ts`, imported by `src/flumeApi.ts`
and eight test files, cited by path from five more. `src/paths.ts` is its
name's file and its header states it stays cycle-free for this. Out of scope
here; mechanical, but it touches every one of those citations, so it wants
an entry of its own.

Also: `tests/pendingLedger.test.ts` took the relocation agreement pin that
was a private-method cast in `tests/Dispatcher.test.ts`.
