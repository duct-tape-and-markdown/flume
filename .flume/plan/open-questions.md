# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## EXIT-CODE-CONTRACT: entry.files omits the test edits the spec-required behavior change forces, and two locked existing assertions directly contradict the new contract

**PARKED** — not a routine "tests[] belongs in files[]" gap (the standing
rule already covers that shape); this one also needs a design call on how
`shipped`/`errored` cross the loop's process boundary.

Attempted this tick; did not ship (per the build prompt's own escape
hatch: don't touch paths outside the entry's declared write fence). Two
distinct blockers, both traced by reading the current implementation
before writing anything:

**1. The declared fence is insufficient (familiar shape).** `entry.files`
(edit) = `src/Dispatcher.ts`, `src/cli.ts`, `CHANGELOG.md`. `entry.tests`
names `tests/Dispatcher.test.ts`, `tests/cli.test.ts`,
`tests/loop-process-boundary.integration.test.ts` — none folded into
`files.edit`, so the write guard (`entryPaths ∪ entryChannelPaths`,
`src/Dispatcher.ts:1152-1160`) reverts any commit touching them. A prior
attempt this tick already hit exactly this (see `<prior-attempt>`
digest: `5307975` reverted for touching all three). This half is the
same shape as `CLI-JUNCTION-SAFE-ENTRY` / `GATECONTEXT-REPOROOT` below —
this doc's standing rule (tests[] paths belong in files[]) applies.

**2. Unlike those two precedents, this isn't just missing *new*
coverage — existing assertions assert the literal opposite of the new
contract, on the only channel that crosses the loop's process
boundary.** `flume loop` re-execs `flume tick` per iteration (§2) and
observes *only* the child's exit code + on-disk baton — no in-process
`TickOutcome` survives the boundary. Two tests lock the two halves of
that one integer today:

- `tests/cli.test.ts:204-212` ("chain resolution failure (§3, other
  Axis-C member) → 1") locks `tickExitCode({failed: true})` to `1`.
- `tests/Dispatcher.test.ts:2995-3023` ("ungated resolution failure:
  child exits non-zero → supervisor logs and proceeds, never crashes
  (§3)") locks `superviseLoop` to *continue* (not abort) when a child
  exits `1` — and its own scenario name is literally the mount-dead
  class v0.7 §4 now requires to abort-on-first-occurrence.

The same integer cannot mean "chain resolution failed, exit 1" *and*
"the loop should treat exit 1 as abort-worthy" without one of these two
tests changing — there is no implementation of §4 that leaves both
green. (A new exit-code constant sibling to `EX_TERMINAL_MISCONFIG`,
sketched as one option in the entry's own notes, would still require
rewriting `tests/cli.test.ts:211`'s expected value and
`tests/Dispatcher.test.ts:2995`'s scenario/title to the new contract —
not additive coverage, a semantics change to existing assertions.)

**3. A real open design question rides along, not just a fence gap.**
`entry.tests` (Dispatcher.test.ts) also wants: "a run with one errored
tick and one shipped entry reports `shipped>0` and `errored>0`."
`superviseLoop`'s only per-iteration signal is the child's exit code
(`src/Dispatcher.ts:1795-1813`, `stdio: "inherit"` — no pipe, so
`SuperviseResult` cannot recover a per-tick shipped/errored classification
from stdout today without a stdio-capture change with its own tradeoffs
against the agent's live-streamed output). Getting `shipped`/`errored`
counts out of `SuperviseResult` needs one of: (a) more exit-code
granularity than a single non-terminal/non-mount-dead bucket allows, (b)
a small per-tick disk artifact the supervisor reads between iterations
(disk-is-truth is already the loop's model), or (c) switching child
stdio to piped + parsed. This is an API-surface call the collaboration
rule says not to make silently.

Options for the re-filed entry:
1. Fold `tests/Dispatcher.test.ts`, `tests/cli.test.ts`,
   `tests/loop-process-boundary.integration.test.ts` into `files.edit`
   (mechanical fix for blocker 1), **and** have the entry's notes commit
   to one shape for blocker 3 up front (new exit-code constant + a
   disk-read per iteration for shipped/errored counts is the cheapest
   combination that reuses the existing process-per-tick model) so build
   isn't the one deciding the API surface.
2. Split into two entries: one for "mount-dead aborts immediately" (exit
   code only, no shipped/errored counting) and a follow-up for the
   shipped/errored summary reporting, so the harder design question
   doesn't block the simpler fail-fast behavior.

Leaning option 2 — smaller blast radius per entry, and the fail-fast half
has a much more mechanical fix than the counting half — but this is an
architecture/API-surface call, flagging rather than deciding unilaterally
per `.claude/rules/collaboration.md`.

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
- HARNESS-BLOCK-EFFECTIVE-FENCE itself: this tick's commit-delta audit
  (c2a83e6 + eb631ec) traced the effective-fence union in
  src/Prompt.ts's effectiveFenceLines against the enforcing union in
  src/Dispatcher.ts's runAfterCommitGates (via builtinGates.ts's
  writablePathsGate) — identical entryPaths ∪ channelPaths construction,
  no drift possible. Docs example and both test files match §2's
  acceptance. This ship is genuine (entry.files were actually touched,
  unlike 8f11af9's park-only commit) — no reopening.
-->
