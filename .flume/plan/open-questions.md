# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS: a build commit touching only entryChannelPaths gets removed from pending.json as if shipped

**NEEDS AMENDMENT** — fix direction is clear; blocked on a spec home
before it can be a pending entry (no section currently governs this
classification).

Caught by this tick's commit-delta audit: `8f11af9`
(`build(HARNESS-BLOCK-EFFECTIVE-FENCE): park`) committed only
`.flume/plan/open-questions.md` — the always-writable
`entryChannelPaths` channel (RELEASE-v0.4.md §5) — no `entry.files`
path touched, a spec-sanctioned park of a judgment call
(`.claude/rules/collaboration.md`, *Inform before parking*). But
`runFanoutEntry` (`src/Dispatcher.ts:1033`) classifies *any* commit
(`postHead !== preHead`) as `committed: true` with no check on which
paths changed; the wave loop (`~L849`) then cherry-picks it, the
`afterMerge` gates pass trivially (nothing in it can break them), and
`shipped.push(r.entry)` fires. `35f8f96` (`chore(flume): ship
HARNESS-BLOCK-EFFECTIVE-FENCE`) removed the entry from `pending.json`
even though no implementation landed — the entry silently vanished
from the backlog. Re-filed this tick (caught only by manual audit).

RELEASE-v0.2.md §6's no-commit taxonomy (`gate-revert` /
`voluntary-bail` / `platform-preempt`) doesn't name this case — all
three are *no-commit* outcomes; this is a commit that happened, passed
every gate, and still shouldn't count as shipped.

Options for a human/spec call:
1. A commit whose cherry-picked diff touches zero of
   `entry.files.{new,edit,retire}` (verified by diff, not just "a
   commit exists") still cherry-picks onto trunk (the channel content
   needs to land) but is excluded from `shippedTags` / does not remove
   the entry from `pending.json`. No new `TickOutcome` variant — a diff
   check gating the `shipped.push` line in `src/Dispatcher.ts`.
2. Same effect, modeled as a fourth no-commit-adjacent classification
   (`channel-only`) alongside RELEASE-v0.2.md §6's three, if the
   taxonomy is judged the right layer to carry it.
3. Do nothing, rely on plan's per-tick audit to catch every recurrence
   — the cost just observed (a full audit pass, and a near-miss on
   catching it at all).

Leaning option 1 (minimal, mechanical, no new taxonomy surface) but
this changes `shippedTags`/`TickOutcome` semantics that RELEASE-v0.2
§6 already owns — flagging rather than deciding unilaterally.

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
- "HARNESS-BLOCK-EFFECTIVE-FENCE: shipping breaks an existing
  out-of-scope test" — closed by applying option 1: re-filed the entry
  with tests/Dispatcher.test.ts + tests/Prompt.test.ts folded into
  files.edit (this tick, after the entry was found dropped from
  pending.json — see SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS above).
-->
