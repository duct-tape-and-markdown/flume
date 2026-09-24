# The cutover, two pages outside build's fence, and a migration page owed

**Cutover.** This repo's live `.flume/plan/state.json` is now the legacy path:
no slice reads it, and it rides `planArtifacts` for every slice so whichever
plan tick runs first can `git rm` it. Nothing writes the new files for you.
Until an operator (or three plan ticks) writes `.flume/plan/state/
plan-derive.json`, `plan-sweep.json` and `plan-inbox.json`, the derive window
bootstraps over the whole spec locus and the sweep over its whole domain — one
expensive tick each, correct but loud. Cheapest path: split the live file by
hand before the next loop start. Inbox needs only `{ "drainedRuns": {...} }`.

**Two pages I could not reach.** Both still name the single artifact and both
sit outside build's fence:

- `CLAUDE.md` (*Workflow: Flume*) — "plan state at `.flume/plan/state.json`".
- `.flume/PROTOCOL.md:70` — "Each owns one cursor in the plan state
  (`plan/state.json`, typed fields ...)". Also now wrong on substance: the
  inbox slice owns `drainedRuns`, not a cursor, and no cursor is shared.

`.claude/rules/spec-plan-build.md` already says `state/`, so the table there
is right.

**A migration page is owed.** This is breaking for consumers twice over — the
state root gains `plan/state/` and loses `plan/state.json`, and
`PLAN_STATE_PATH` left `SHARED_PROMPT_DATA_KEYS` for `planSlicePromptArgs`
(a chain rendering the package's prompts itself must call it). `docs/` holds
`MIGRATING-0.18.md` as the newest; 0.19 has no page and I did not open one —
the entry did not scope it and the release cut is where the series is
assembled. Route it.

**One gate state went unreachable.** Derive's file holds one field, so a tick
carrying its cursor forward writes byte-identical content and touches no path:
the cursor gate now skips where it used to judge a step of zero. Its case was
retitled to a real forward step, which covers the same green arm.
