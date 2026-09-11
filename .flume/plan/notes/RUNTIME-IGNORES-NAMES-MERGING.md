# The spec's ignore block still spells `last-tick.json`

`spec/jobs.md` "Runtime ignores" lists the merged set verbatim, and its
seventh line (:113) reads `last-tick.json`. The runtime has spelled that
`tick-verdict.json` since the verdict rename (`STATE_ROOT_NAMES.tickVerdict`,
src/paths.ts:84); `docs/CHAIN-AUTHORING.md:116` agrees with the
runtime. So the spec block — the very `per` target this entry derived from —
is the one copy of the list that is stale.

Why it matters: `docs/CHAIN-AUTHORING.md`'s copy is equality-pinned to
`RUNTIME_IGNORES` (tests/retired-narration.test.ts:1375) and so cannot drift.
The spec's copy is pinned by nothing, which is how a name went stale there
unnoticed and why the `merging/` gap sat open long enough to need an entry.
A drift the pinned copy cannot have is evidence the unpinned copy wants the
same treatment — either a pin reading the spec block through the real writer,
or the block shrinking to a pointer at `RUNTIME_IGNORES`
(`.claude/rules/engineering.md`, "Derived state is computed, never restated
beside its source").

Spec is the human's surface, so this is plan's to route, not build's to fix.
