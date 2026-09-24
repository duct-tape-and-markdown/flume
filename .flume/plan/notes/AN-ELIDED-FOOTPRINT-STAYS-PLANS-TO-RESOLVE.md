# The elision is pinned; the bound the case hunts for is still nobody's to state

The pin landed in `tests/harnessHandoff.test.ts`, beside the two sibling
cases the blocker shipped: a `not-shipped` record whose footprint the writer
cut stays a standing refusal, so the drain opens and the entry stays plan's.
No behavior changed — the safe direction already fell out of `continuation`
(`harness/standingRefusal.ts`).

Two things worth the next tick's attention.

**1. The case has to hunt for the engine's bound.**
`MAX_PRIOR_TOUCHED_PATHS` is module-local in `src/priorAttempts.ts`, and the
case must produce a real elision rather than stamp `omittedPaths` by hand
(`engineering.md`, *A seam gate reads what the real writer wrote*). So it
doubles a filler footprint until `buildNotShipped` states an omission, capped
at 65536 with a throw. That works and never goes stale against a bound the
engine moves, but it is a test searching for a constant the engine holds and
reports nowhere — adjacent to *A fact the engine holds is reported*, though
this consumer is a test rather than a chain, so I did not file it. If the
third fork in the note beside this one — a chain declaring paths the
footprint must not elide — is taken, that surface would state the bound too
and the search goes away.

**2. The record fixture's anchor is now its own helper** (`entryAnchor`), so
the hand-built bodies and this case's real-writer body file under one
identity. The file's second, describe-local `attempt` helper still spells its
own anchor, with `declaredAs` the module-level one has no use for — two
anchors in one file, which is debt rather than a defect, and merging them
means the module-level one grows an argument only one caller passes.
