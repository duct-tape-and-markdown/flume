# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## CLI-JUNCTION-SAFE-ENTRY: entry.tests names a file outside entry.files scope

**NEEDS AMENDMENT**

Same shape as the GATECONTEXT-REPOROOT-TESTS precedent below: the
CLI-JUNCTION-SAFE-ENTRY pending entry's `tests[]` names
`tests/cli.test.ts`, but `files.edit` only lists `src/cli.ts` and
`CHANGELOG.md`. The write-guard fence for a scoped tick is
`entry.files ∪ entryChannelPaths` (`.flume/chain.ts` §build,
`entryChannelPaths: [".flume/plan/open-questions.md"]`) — `tests/**` is
in the phase's outer `writablePaths` ceiling but not in this entry's
narrowed fence, so touching `tests/cli.test.ts` reverts the commit (this
already happened once: `ae38b4a`, reverted for exactly this reason).

This tick ships only `src/cli.ts` + `CHANGELOG.md` (the realpath fix
itself, acceptance-green) and deliberately skips the test file to avoid
repeating the revert. Applying the standing Derive-dimension rule from
the GATECONTEXT-REPOROOT-TESTS precedent: file a follow-up entry (e.g.
`CLI-JUNCTION-SAFE-ENTRY-TESTS`) whose `files.edit` declares
`tests/cli.test.ts` explicitly, covering: dist/cli.js reached through a
junction-equivalent path (realpath differs from argv[1]) still runs
main(); a plain import runs nothing; `realpathSync` throwing falls back
to the raw comparison without crashing the import.

<!-- none open this tick — the one carried question closed by routing, and all three prior questions closed by spec/RELEASE-v0.7.md:

- "GATECONTEXT-REPOROOT: entry.tests names files outside entry.files
  scope" — routed to a filed follow-up (GATECONTEXT-REPOROOT-TESTS,
  files declares the two test paths so the write guard allows the
  edit). Option 2 from the prior write-up (tests[] paths belong in
  files[]) is already this doc's standing Derive-dimension rule, not a
  new decision — applied going forward, no amendment needed.
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
