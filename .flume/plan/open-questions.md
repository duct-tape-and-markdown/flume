# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## HARNESS-BLOCK-EFFECTIVE-FENCE: shipping breaks an existing out-of-scope test, not just a coverage gap

**PARTIALLY ADDRESSED** — implementation verified locally (tsc clean,
spec-conformant per RELEASE-v0.7.md §2); not shipped. `files` needs to
grow before this can land — this is not closeable by a follow-up
coverage entry alone.

`prependHarnessBlock` on a scoped tick must render `entry.files ∪
phase.entryChannelPaths` as the effective fence (§2). But
`tests/Dispatcher.test.ts:1442` ("reverts a path outside entry scope but
inside phase globs; the retry prompt names it") asserts
`expect(prompts[1]).not.toContain("- src/a.ts")` against the retry
prompt for an entry whose `files.edit` is `["src/a.ts"]` — i.e. it
encodes the *old* collapsed rendering (entry.files never named in the
harness block) as a correctness invariant. Implementing §2 correctly
makes that assertion false: the retry prompt's harness block now
legitimately lists `src/a.ts` as part of the effective fence.
`tests/Dispatcher.test.ts` is outside this entry's `files`.

This is a harder version of the standing GATECONTEXT-REPOROOT-TESTS /
CLI-JUNCTION-SAFE-ENTRY-TESTS shape (`entry.tests` naming paths outside
`entry.files`): those precedents shipped `files`-only because the
missing coverage didn't break anything already green. Here, shipping
`files`-only still fails the `afterMerge` vitest gate outright — a
regression in an unrelated existing assertion, not a coverage gap — so
there is no partial-ship path; the whole commit reverts regardless of
what accompanies it. This is the second attempt at this entry to reach
this conclusion (first: voluntary-bail, unshipped, no commit).

Options for closing, for plan to choose between:
1. Fold `tests/Dispatcher.test.ts` into this entry's `files.edit`,
   narrowing the `L1517` assertion to the substring it actually means to
   pin (the `<prior-attempt>` / gate-detail line, e.g.
   `"src/stray.ts (inside phase writablePaths but outside"`) rather than
   a blanket `not.toContain` over the whole prompt — since the harness
   block correctly naming entry-declared files is now intended behavior.
   Bundle `tests/Prompt.test.ts` in the same `files.edit` for the new
   coverage `entry.tests` already calls for.
2. Split into two coupled entries landed in the same wave (impl +
   existing-test fix as one; new coverage as a strict follow-up) — no
   material difference from option 1 beyond bookkeeping.

No third option observed: the `files.edit` fence and the `afterMerge`
full-suite gate leave no way to land the §2 behavior change without
touching the one test that encodes the pre-§2 invariant.

<!-- none open this tick — the one carried question closed by routing, and all four prior questions closed by spec/RELEASE-v0.7.md or by filing a follow-up entry:

- "CLI-JUNCTION-SAFE-ENTRY: entry.tests names a file outside entry.files
  scope" — same shape as GATECONTEXT-REPOROOT-TESTS below: 08c2ace
  shipped src/cli.ts + CHANGELOG.md only (tests/cli.test.ts would have
  reverted the scoped commit). Routed to a filed follow-up
  (CLI-JUNCTION-SAFE-ENTRY-TESTS, files declares tests/cli.test.ts so the
  write guard allows the edit).

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
