# Three signatures took their caller's bundle; two siblings in the same family remain

Shipped as named: `invokeAgent` (`src/tickAttempt.ts`) and `runFanoutEntry`
(`src/waveTick.ts`) now take `(ctx, opts)` / `(leg, opts)`, and
`standingRefusals` (`harness/standingRefusal.ts`) takes
`(stateRoot, window)` where `window` is
`Pick<SliceWindow, "pending" | "priorAttempts" | "claimed">` — the exact set
both `SliceWindow` and `WindowContext` already carry, so `inboxWindow.ts`
passes each surface whole. Behavior byte-identical; no test assertion changed.

Two things the next plan tick may want to weigh, neither re-noted as the same
family (this entry was its one filing):

1. `offered` was spelled as an anonymous three-field object type in two places
   in `src/waveTick.ts` (`carrySlot`, `runSlot`) plus a literal at the refill.
   Naming it was forced by the new signature, so it is now `OfferedFacts`,
   one declaration, and `runFanoutEntry` spreads it straight into the
   `TickContext` it builds. That is the vocabulary-spelled-twice shape
   `engineering.md`, *A module is one job* names, closed incidentally.

2. `runAfterCommitGates` (`src/tickAttempt.ts`) is still seven positionals,
   three of which (`phase`, `chain`, `cwd`) its one caller `runAttempt` holds
   in the bundle it was handed, and `checkTipMovedPerEntry` beside it is six.
   Both are the same shape this entry closed at three other bodies, left
   untouched because the entry named its sites. Not re-filed here; if the
   family is worth finishing, it is one more mechanical entry over those two.

`harness/standingRefusal.ts` now type-imports `SliceWindow` from
`./handoff.js`, which value-imports `isStandingRefusal` back — a type-only
edge, erased at runtime, and the precedent is `sliceWindow.ts`, which already
`Pick`s the same interface across the same edge.
