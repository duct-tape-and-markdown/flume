# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## GATECONTEXT-REPOROOT: entry.tests names files outside entry.files scope

**PARTIALLY ADDRESSED** — shipped without the two test edits; a follow-up
entry or plan amendment is needed to land them.

The `GATECONTEXT-REPOROOT` pending entry's `tests` array names
`tests/Gate.test.ts` and `tests/Dispatcher.test.ts`, but its `files`
array (which — per v0.4 §5 — is what narrows the fanout write guard to
`entry.files ∪ phase.entryChannelPaths` on a scoped tick) lists only
`src/Gate.ts`, `src/Dispatcher.ts`, `CHANGELOG.md`. A prior attempt
(c20fa0a) added the two test files and was reverted whole by the
writable-paths gate for touching paths outside that narrowed allowance.

This tick shipped `repoRoot` as an **optional** field
(`repoRoot?: string`) specifically to avoid needing to touch
`tests/Gate.test.ts` — its `ctx()` fixture helper builds a `GateContext`
literal without `repoRoot`, and tsc runs over `tests/**` (see
`tsconfig.json`), so a required field would fail tsc on that file even
without touching it. Making it optional keeps existing fixtures
compiling while every dispatcher-constructed context sets it, so the
acceptance criterion (a gate in a fanout worktree receives that
worktree's root) holds — but no test yet exercises the new field.

Options for closing the gap, for plan to choose between:
1. File a follow-up entry whose `files` includes the two test paths (so
   the write guard allows it), adding coverage for `repoRoot` plumbing
   and updating `ctx()` to accept an optional override.
2. Broaden this pattern generally: when a pending entry's `tests` cites
   a path, plan includes that path in `files` too, so scoped ticks never
   hit this wall — likely the more durable fix, since it'll recur for
   every entry with a `tests` field.

<!-- none open this tick — all three prior questions closed by spec/RELEASE-v0.7.md:

- "Engine-ownership requests from centercode-platform's chain" — v0.7 §1
  rules items #3 (GateContext.repoRoot) and #4 (exit-code contract) into
  this line (filed as GATECONTEXT-REPOROOT, EXIT-CODE-CONTRACT); items
  #1/#2/#5 (the structured-verdicts family: pending.json schema validation
  at the plan gate, plan-time path pre-checks, persisting revert verdicts)
  are explicitly declined for v0.7 and held for "a v0.8 line of their
  own" — an operator-level disposition already recorded in spec, not an
  open question anymore.
- "CLI entry silently no-ops through a directory junction" — v0.7 §3
  confirms the realpath-comparison fix; filed as CLI-JUNCTION-SAFE-ENTRY.
- "Harness block states the wrong (unnarrowed) revert fence on
  entry-scoped ticks" — v0.7 §2 confirms the effective-fence rendering;
  filed as HARNESS-BLOCK-EFFECTIVE-FENCE.
-->
