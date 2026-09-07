# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `src/Dispatcher.ts` (4873 lines) bundles several jobs that read as separate homes (PARKED — trigger fired)

Posture sweep (`.claude/rules/posture-sweep.md` standing lens: "a module carrying jobs that want separate homes") over the `src/Dispatcher.ts` neighborhood found the file's own `// ---------- X ----------` markers delineating distinct concerns: chain load+validate, tick-verdict I/O, singleton tick, fanout tick + per-entry fanout, worktree/friction/prior-attempt helpers, loop supervisor. Sibling engine files stay well under 1000 lines.

Not filed as a mechanical fix: `Dispatcher.ts:42-44` documents a constraint that shaped the current structure — `buildFlumeApi` is a function rather than a constant "precisely so" a chain can't resolve a second physical engine, which implies at least the chain-load/`FlumeApi` surface is deliberately colocated with the dispatcher. Whether tick-execution, worktree/friction/prior-attempt, and loop-supervisor concerns share that constraint, or could split cleanly, needs a design call.

Options:
- **A — split along the marked seams**, keeping only what the `buildFlumeApi` cycle constraint actually requires colocated.
- **B — leave it whole**, citing the cycle-avoidance constraint as the deliberate divergence (`engineering.md` "The fix lands at the mechanism" allows a declared exception).
- **C — narrower split**: extract the clearly acyclic concerns (worktree/friction/prior-attempt helpers, loop supervisor) and leave chain-load + tick execution together.

**2026-09-03 sign-off:** sequenced to the line after 0.13.0, option left open until the operator opens that line. **The trigger fired**: 0.13.0 cut 2026-09-03 (`946723e`). The file has since grown by two more spec-derived surfaces this tick (`Chain.pendingPath`, the hook-receives fields) and gained ~40 lines. Ripe for A/B/C now — needs the operator's pick, not another derive tick's guess.

## `flume check`'s fence collapses to universal rejection when a chain declares zero fanout phases (PARKED)

`src/cli.ts` derives `check`'s fence from `chain.phases.filter(p => p.concurrency === "fanout")`. Nothing in `src/Phase.ts`'s `Concurrency` type or chain-load validation requires at least one fanout phase — per `spec/pending.md` ("Selection is the sole site; a singleton phase does not pick from pending"), a chain with only singleton phases is structurally legal, it just never consumes `pending.json`. For such a chain, `consumerPhases` is `[]`, the fence is empty, and every declared path in `pending.json` reads as a violation — misdiagnosed as "declares files outside the consumer phase's fence" when the real story is "no consumer phase exists." `spec/cli.md`'s `check` description doesn't address this case.

Options:
- **A — vacuous pass.** Zero fanout phases means nothing will ever pick from the queue; skip the fence step (mirrors how `check` already treats an absent `pending.json`).
- **B — keep rejection, fix the message.** Name "no fanout phase declared" distinctly from "paths outside the fence."
- **C — enforce the invariant earlier.** Chain-load validation refuses a chain with zero fanout phases and a non-empty `pending.json` outright.

This repo's own `.flume/chain.ts` always declares one fanout phase (`build`), so the case doesn't manifest here — a second-implementation question (`engine-boundary.md`), not a bug against current usage.

## `Chain.worktreesDir` — Placement ruling needed before deriving (PARKED)

Two inbox findings converge on the same defect: a chain that relocates the worktree base (`FLUME_WORKTREES_DIR`, off-repo per `spec/worktrees.md` *Placement*) is read by `createWorktree` but not by the loop-startup sweep (`sweepStaleWorktrees()` runs before `resolveChain()`) — the sweep bases on the default location, finds it empty, removes nothing, then `git branch -D` fails for every `flume/*` branch still held by a worktree at the real (relocated) base. Field-traced four times at temper after a WSL shutdown.

Fix shape both findings agree on: `Chain.worktreesDir`, read by the supervisor after chain load and before the sweep — the same value `createWorktree` uses. What's undecided: whether the existing `FLUME_WORKTREES_DIR` env override survives alongside the new field, or is retired in its favor. **Do not derive until `spec/worktrees.md` and `spec/chain.md` carry the field** — this needs the Placement ruling first, not a guess.

Supersedes the `DispatcherOptions.worktreesDir`-resolved-in-cli.ts framing from the earlier loss-audit finding (that shape still misses a chain-set value; `Chain.worktreesDir` is the corrected fix shape).

## `docs/INTENT.md` contradicts the code in two places and carries executed decisions (PARKED)

Three items, one file, human edits (docs/ is build-writable but these are narrative/product judgment calls, not mechanical):

- (a) The Provenance spine bullet says the harness verifies typed inter-layer citations; `per` left the engine core in 0.8.0 and is opaque to it today (confirmed: `per` is a chain-declared extension field, engine never parses it). **Recommend:** restate to match 0.8+.
- (b) "v0 success criterion" was never re-proven and cannot be — the comparison target (`bin/flume-bash`, gen2 specs) no longer exists in any live tree. **Needs a human call:** retire it, or restate against a measurable target (e.g. the dogfood ship ledger).
- (c) "Decided, not yet executed — spec corpus reform" has executed. **Recommend:** delete.

Raised independently by cascade's session for (b).

## `examples/prompts/spec.md` models a retired consumer shape — cut it? (PARKED)

Models a workshop/ → specs/active → specs/_aligned partition that cascade dropped in June; no current consumer has a spec phase. A new adopter would build the shape flume's own consumer abandoned. No clean `per` cite into spec (this is repo hygiene, not spec-derived), which is why it's parked rather than filed — `spec-plan-build.md`: "If a candidate plan entry can't carry a clean per cite into the spec, it's a question for a human."

**Recommend:** cut it, keep plan/build examples only — corroborated independently by cascade's session, low risk (build can execute the deletion once approved).

## Voluntary-bail is inferred intent — taxonomy ruling needed (PARKED — do not derive)

A clean exit with no commit is recorded as "the agent refused a constraint" (`classifyNoCommit`), and that label is persisted into the prior-attempt record the next tick renders. An agent that ran out of turns, or found nothing to do, gets a block saying it refused to cross a constraint. Predates v0.3.

Fix shape is a chain-declared bail signal with the engine recording only `clean-exit` — a taxonomy change, not a mechanical fix. Filed here per the original inbox instruction: parked for the human, do not derive.

## Docs backlog: multi-minor jump index, and a restoration note on MIGRATING-0.12 (PARKED)

Two small, independent, low-priority docs asks bundled for one sign-off:

- **Cumulative migration index.** Fourteen releases in four months, four migration guides, one superseding two — a consumer pinned several minors back faces a routing table. Ask: one cumulative index in `docs/` mapping each consumer-visible symbol to the release that changed it. Docs lane, build can derive once approved. Raised independently by cascade's session.
- **`docs/MIGRATING-0.12.md` §1 restores v0's gate placement without saying so.** "Put correctness gates at afterMerge" is where v0 put them before `afterCommit` became the documented placement. A v0-shaped chain that never moved is already compliant and cannot tell from the guide. Ask: one line naming it a restoration. Raised independently by cascade's session.

Neither has a spec cite to derive against; both are product-priority calls (worth the docs investment?), not mechanical fixes.

## Quarantine keying survives a re-scope — spec amendment needed first (PARKED)

`spec/loop.md` *Repeated identical failures — quarantine, then abort* deliberately keys the run-scoped quarantine by **slug alone** — current code matches spec exactly, this is not a bug. Field report (temper, 0.12.0): an operator's re-scope commit on trunk doesn't lift the quarantine on that slug, because the key never changed; the only recovery is stop-and-relaunch.

Proposed fix keys on the entry *as read* (slug + a hash of entry content, or the sha it was read at) so a changed entry is a new key, with the key reported alongside `quarantinedTags` so a chain can see why it stands. This is a deliberate change to ratified behavior, not a derivable gap — needs a `spec/loop.md` amendment before any pending entry can cite it.

## Supervisor killed mid-merge leaves an ungated, unrecorded commit on trunk — spec edit pending (PARKED, gh#19)

`spec/loop.md` *Crash equals stop* covers the worktree side of a crash but not a commit already cherry-picked to trunk past the last verdict's `headSha` with no afterMerge gates run and no ship bookkeeping. Field-traced once at temper (0.12.0): a background task killed mid-merge left a cherry-picked commit ungated, `pending.json` still listing the entry open (next run would have double-cherry-picked), four orphaned worktrees, no lock or pid.

Filed as **gh#19** with full repro. The operator is opening the spec line for this (a startup check under the tip claim, or a `flume resume-merge` verb); do not derive further until that edit lands. Boundary note for whoever writes it: detect from the surviving `flume/<slug>` branch (teardown never ran) and the orphaned worktree dirs the startup sweep already enumerates — never from commit shape or authorship (`engine-boundary.md`, *Told, not inferred*).

## A build park cannot wake plan — the loop livelocks on a parked entry (PARKED — chain.ts, harness surface)

Field-traced 2026-09-06: FLUMEAPI-PATHS parked four times with the same
verdict, and plan never ran to act on it. The operator had to tick plan by
hand. Verified on disk this tick:

- `build.shipped` (`.flume/chain.ts`) *does* read a park — a commit touching
  only `PARK_FILE` returns false — so the engine records the entry
  `not-shipped` in the tick verdict (`src/Dispatcher.ts:2655`).
- But `not-shipped` is a **committed** outcome, so it writes no
  `PriorAttempt`. `NoCommitMode` (`src/Prompt.ts:56`) has no such variant,
  correctly — nothing was un-committed.
- `plan.shouldRun` returns false whenever anything is pickable unless
  `inboxHasEntries()` or `anyVoluntaryBailRecord()`. A park satisfies
  neither, so plan declines and build is re-dispatched against the same
  fence forever.

`build.handoff` is not the gap — it wakes plan (a park carries gate results).
The gap is that the wake is declined.

**Recommendation (chain-side; no engine entry).** `plan.shouldRun` reads the
last build tick verdict via `readLatestVerdictsSync`, already on the
`FlumeApi`, and returns true on a `not-shipped` outcome. That is durable
on-disk state the engine owns, read the way `anyVoluntaryBailRecord` already
reads prior-attempts — not a re-derivation. Alternative worth weighing: now
that `TickResult.entries` ships (`1cadcce`), a park is also legible to
`handoff` as `committed: true, shipped: false, reverted: false`; a marker
written from there would work but adds a second copy of a fact the verdict
already holds (`engineering.md`, *Derived state is computed*).

Needs a human `chore(flume):` commit — `.flume/chain.ts` is outside both
phase lanes.

## Two facts the engine holds have no field to report them — both need a spec-enumeration amendment (PARKED)

Same shape, bundled for one sign-off. Each is a fact the dispatcher already
computed, on a record whose spec section enumerates the fields verbatim — so
neither can be derived without the human widening the enumeration first
(`engineering.md`, *A fact the engine holds is reported, never rediscovered*).

- **A gate cannot say "not applicable."** `GateResult` is
  `{ok, message, details?, failingFiles?}` (`spec/chain.md`, *What a gate
  returns*), so this chain's commit-scoped vitest skip (`6fd900b`) reports a
  green with a message. A skip that reads as a pass is a green over nothing
  (`engineering.md`, *A green verdict is proven non-vacuous*), and it also
  inflates `gateResults.length`, which `build.handoff` uses as a wake signal.
  Fork: add `skipped?: true` to `GateResult`, or rule that applicability is
  the chain's business and a skip legitimately reports green.
- **A fanout entry whose `setupWorktree` threw reports nothing.**
  `setupFailedIndices` (`src/Dispatcher.ts:2260`) is consumed only to skip
  the agent and reaches no surface. Such an entry appears in the newly-shipped
  `TickResult.entries` as `{committed: false, shipped: false, reverted: false}`
  with no `noCommit` and no `declined` — indistinguishable from an unexplained
  nothing, and invisible to a chain reconciling a failed provision. The
  enumeration in `spec/chain.md`, *What a hook receives*, would need the field.

## Three `Drift:` notes in `spec/chain.md` describe work that has landed (PARKED — spec housekeeping)

`5f4e449` shows the convention: a human spec commit closes drift notes once
the code catches up. Three are now stale, and a stale one is worse than
absent — plan's derive dimension reads them as live gaps and would file
entries for shipped work.

- `:241` — "`ClaudeCodeOptions` has no `model` today." It does:
  `src/Agent.ts:145`, with `AgentUsage.model` at `:66` (landed by `798f72f`).
- `:569` — "none of `pickable`, `priorAttempts`, `pickableAfter`, `flumeDir`,
  `configDir`, `entries` exist on the contexts today." All six exist
  (`src/Phase.ts`, `1cadcce` and its predecessor).
- `:646` — the ordering half ("`main()` dispatches the job-management verbs
  before it reaches `resolveStateDirs`") is stale per `e814195`. The
  `FlumeApi.paths` half is still live; FLUMEAPI-PATHS closes it.
