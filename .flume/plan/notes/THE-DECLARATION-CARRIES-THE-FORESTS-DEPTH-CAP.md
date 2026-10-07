# The depth cap landed; this repo still runs at the engine default

**Where the tests went.** The entry predicted the field's acceptance in
`tests/harnessDeclaration.test.ts`; the `Chain` passthrough went to
`tests/harnessChain.test.ts` instead, beside `capabilities`,
`worktreesBase` and `friction`, which all keep a declared/absent pair
there. The declaration file got the field in `fullDeclaration()` and the
two doc walks, which is what it already owns.

**A vocabulary, not three parameters.** `harness/gates.ts` reads the
queue at three sites — the pending gate, the goal-rank gate, and the
records gate's step descent — and each needed the cap beside the
extension. They now share one internal `QueueParse` value rather than a
second scalar threaded through three signatures, so a fourth read joins
by taking the value.

**`.flume/declaration.ts` names no cap, and build cannot reach it.** This
repo's queue still reads at the engine's four on every side. If flume
should declare its own, that is a human edit to the declaration under
explicit direction — not something a build fence admits.

**Possible follow-up.** `docs/CHAIN-AUTHORING.md` §10 still tells a
hand-authoring chain to pass the same number to `pendingGate` and to
`renderSchemaForPrompt` so the two cannot disagree. That is still true at
the engine level, but a package consumer now has one field that does it,
and the two passages do not point at each other. A cross-reference would
spare an adopter working out which layer they are on.

**Test-helper widening.** `tests/harnessPrompts.test.ts`'s `args` and
`render` gained a trailing declaration parameter (defaulting to the
file's own), since every case there shared one parsed declaration and the
new case needs a second. The existing depth-cap case's `chainOfParents`
and queue read were hoisted to module scope so both cases read one
spelling.
