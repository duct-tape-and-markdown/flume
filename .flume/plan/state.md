# State

Phase: v0.9 "the doctrine line" shipped and audited. Zero commits since
the last `plan:` commit (`28df0d5` is HEAD) — no audit, no derive, empty
inbox, nothing blocked to promote.

Mode: maintain. The sweep is the tick's only live dimension; the rotation
armed by `76b6ab9`'s phrase delta stays open.

## Queue (7)

Head: GITIGNORE-RUNTIME-ARTIFACTS. Then INLINE-EXEC-NO-WIN32-SHELL-RETRY
(new, ordered ahead of the changelog backfill — it is a silent-wrong-output
defect), CHANGELOG-0.9.0-BACKFILL, SCHEMA-PROMPT-AGREEMENT-GATE,
PARSEPENDINGLOOSE-WRITE-PATH-PIN, PENDING-GATE-HINT-OPTION,
ERA-SCOPED-NARRATION-PROMPT-NEIGHBORHOOD (new, prose-only, last).

## Open questions (4)

Unchanged: pendingGate dual-violation report; setupWorktree/gate
manager-detection sharing; win32 inline-exec argv mangling (gained a
one-line cross-ref to the new retry entry); `<exec-failed>`
loud-or-nothing.

## Posture sweep

Posture swept through: `2874c2c` (carried forward; rotation open).

Covered this tick: the `src/Prompt.ts` neighborhood — `Prompt.ts` and its
one value import `builtinGates.ts`, both read in full. Its other two
imports (`Phase.ts`, `PendingSchema.ts`) are type-only and were not read,
so they stay in the frontier.

Remaining frontier: 11 of 14 `src/` modules (all but `Baton.ts`,
`Prompt.ts`, `builtinGates.ts`), all of `tests/`, `bin/`, `examples/`.

## Trunk

HEAD `28df0d5`. Next tick: take the next neighborhood, or audit/derive if
commits or a `spec/` change land first.

Plan continues: yes — sweep frontier open (11 src modules plus tests/, bin/, examples/)
