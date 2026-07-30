# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## SETUP-WORKTREE-DOGFOOD-ADOPTION: §11's dogfood chain.ts adoption bullet shipped nothing — entry cleared from pending.json anyway

**PARKED** — direction is fully mechanical; blocked purely on the
writable-paths fence, not on any judgment call. Needs a direct operator
`chore(flume):` commit, same shape as PROMPTS-BUILD-FENCE-INSTRUCTION.

`spec/RELEASE-v0.7.md` §11 names three deliverables: (1) ship the
`setupWorktree` helper, (2) rewrite the `CHAIN-AUTHORING.md` worked
example, (3) "Flume's own dogfood chain (`.flume/chain.ts`) adopts the
helper in place of `buildSetupWorktree` — dogfood discipline, flume ships
flume." `5a56f7a` shipped (1) and (2) only — correctly, since the
re-filed `SETUP-WORKTREE-HELPER` entry (prior tick) dropped
`.flume/chain.ts` from `files.edit`, because build's `writablePaths`
explicitly exclude it (`chain.ts:247` — "build does NOT touch
`.flume/{chain.ts,prompts/**}`... edits flow through `chore(flume):`
commits, not build ticks"). `ac8c973` then cleared the entry from
`pending.json` entirely, as if §11 had fully landed. It hasn't: verified
this tick that `.flume/chain.ts:95-103`'s `buildSetupWorktree` still
hardcodes `pnpm install --frozen-lockfile` directly — no import of the
new `../src/setupWorktree.ts` export, no call to it.

Plan can't file this as a pending entry (build can't ship it — same
fence) and plan's own `writablePaths` don't reach `.flume/chain.ts`
either, so this tick can't apply it directly. Recommended: an operator
session applies a small `chore(flume):` commit replacing
`buildSetupWorktree`'s body (`.flume/chain.ts:95-103`) with a call to the
exported `setupWorktree(ctx.worktreePath)`, then removes the now-dead
`buildSetupWorktree` wrapper if nothing else references it. Precedent:
PROMPTS-BUILD-FENCE-INSTRUCTION, closed the same way (operator commit
`6005318`).

## HANDOFF-NOCOMMIT-BLIND: `TickResult` can't distinguish voluntary-bail from a genuine no-op, so no chain handoff can wake plan on bail

**NEEDS AMENDMENT** — fix direction is clear; blocked on a spec home (v0.7
§1 is the same "engine misstates itself" theme but its declared blast
radius names `src/` Prompt/cli/Dispatcher-exit-paths/GateContext only and
explicitly excludes chain content — "No chain or prompt content ships
from this line" — so a `.flume/chain.ts` handoff edit can't ride it).

Drained from inbox (operator pass): SETUP-WORKTREE-HELPER bailed twice
(declared `.flume/chain.ts` off-fence for build, correct refusal per
`prompts/build.md:27` — "Plan re-derives next tick and routes it as an
open question"). That promise never fires: build's `handoff` in
`.flume/chain.ts:289-299` wakes plan only when `shippedTags.length > 0 ||
gateResults.length > 0`. Traced deeper than the inbox report guessed —
this isn't a chain-config oversight, it's an engine one. `Dispatcher.tick`
(`src/Dispatcher.ts:710-717`) destructures `{ result, noCommit }` from the
wave runner but only ever passes `result` into `phase.handoff(result)`;
`noCommit` (the §6 `voluntary-bail`/`platform-preempt`/`gate-revert`
classification) is discarded before handoff ever sees it. `TickResult`
(`src/Phase.ts:52-75`) has no field carrying it. On a pure-bail wave,
`committed: false`, `shippedTags: []`, `gateResults: []` — identical to a
genuine "nothing pickable" no-op. No chain author, however written, can
tell the two apart today; this isn't a matter of `.flume/chain.ts`'s
build `handoff` making the wrong call, it structurally cannot see the
right one.

Fix direction (mechanical, once a spec section exists):
1. Add `noCommit?: NoCommitMode` to `TickResult` (`src/Phase.ts`),
   reusing the type already defined in `src/Dispatcher.ts`.
2. `Dispatcher.tick` folds the already-computed `noCommit` into `result`
   before calling `phase.handoff(result)`.
3. `.flume/chain.ts`'s build `handoff` adds `result.noCommit ===
   "voluntary-bail"` to its wake condition.

No tradeoff to weigh — this is a straight visibility gap, not a design
choice. Needs a spec line because (a) it's a `Phase.ts`/`Dispatcher.ts`
API-surface change outside any shipped section's blast radius, and (b)
step 3 edits `.flume/chain.ts`, which v0.7 §1 explicitly bars this line
from touching. Candidate home: a v0.8 continuation of v0.7's "engine
truth-telling" theme, or its own short section — human's call.

## ENGINE-PIN-HANDSHAKE-JOB-DIR-MISMATCH: the local-install check path never matches what `job new` actually provisions

**PARKED** — shipped per the spec's literal (twice-repeated) path text and
matching acceptance criteria exactly; flagging because the one existing
provisioning mechanism in the codebase never creates a link there.

`spec/RELEASE-v0.7.md` §10 states the local-install check path twice,
verbatim, as `<bay>/.flume/node_modules/@dtmd/flume`. ENGINE-PIN-HANDSHAKE
(this tick) implements `readLocalInstall`/`engineHandshake` in `src/cli.ts`
against exactly that bay-root path, independent of `--job`/`FLUME_JOB`
scoping. But `ensureFlumeLink` (`src/job.ts:133-150`, called from `jobNew`)
never provisions a link there — it always nests one level deeper, at
`<repoRoot>/.flume/jobs/<name>/node_modules/@dtmd/flume`. As shipped, arm
1 ("local install exists" → re-exec) can never fire for a bay reached
through the real `job new`/`job run` workflow; it only fires against a
link fabricated by some other means (this entry's own test fixtures do
exactly that, by hand, since the handshake only ever reads the link).

Two readings were live going in:
1. **Literal** (shipped): check the exact bay-root path §10 states,
   independent of job scoping. Matches spec text and acceptance verbatim;
   simplest; "one hop only." Doesn't compose with the job workflow's real
   provisioning — dead on arrival for every existing job-based bay.
2. **Job-scoped**: check `<flumeDir>/node_modules/@dtmd/flume`, where
   `flumeDir` is the same value `resolveStateDirs` already computes (a
   bare bay reduces to exactly reading (1); a `--job`/`FLUME_JOB`-scoped
   invocation resolves to `<repoRoot>/.flume/jobs/<name>/node_modules/@dtmd/flume`
   — what `ensureFlumeLink` actually provisions). Composes with the real
   workflow; not what the spec's literal text says.

Went with (1): the spec states the check path twice, verbatim, and the
acceptance criteria never mention job-scoping — a build tick shouldn't
quietly reinterpret a doubly-explicit literal path on its own judgment.
But (2) is the only reading under which arm 1 ever fires against real
production provisioning, which makes me suspect (1) is a spec wording
gap rather than a deliberate bay-wide (non-job) resolution point. If the
intent was (2), needs a small follow-up: swap the fixed path in
`readLocalInstall`/`engineHandshake` for a `resolveStateDirs`-derived one
(no `job.ts` change needed either way), and re-point this tick's three
test fixtures at the job-scoped path. Needs a human call — this is "does
the spec's literal wording match the intended machinery," not a UX taste
call.

## TAG-PATTERN-SLICE-CONSTRAINT: rendered pending-entry schema omits the `[a-z0-9]+` slice constraint TAG_PATTERN enforces

**NEEDS AMENDMENT** — fix direction is clear; blocked on a spec home (no
shipped section governs `PendingSchema.ts`'s self-consistency — v0.7 §1
is this same "engine misstates its own enforcement" theme, but its
declared blast radius excludes `PendingSchema.ts`).

Drained from inbox (jeff pass, DAL job mining): `TAG_PATTERN`
(`src/PendingSchema.ts:71`) requires a tag's parenthesized slice to match
`[a-z0-9]+` — lowercase only, no underscores — but `renderSchemaForPrompt`
never states that constraint. A `DAL-REWIRE(usp_Filter_Get)`-shaped tag
(mixed case, underscore) passes the rendered schema and fails the real
regex, burning a full tick revert (`bb3ef7f2b2`, centercode-platform).

Two fix directions:
1. Widen the paren-slice group (e.g. to `[A-Za-z0-9_]+`) to tolerate
   real-world identifier-shaped slices like DB object names.
2. Render the real constraint into the tag line instead.

Leaning option 1 — the DAL example is a legitimate tag a plan agent has
no reason to reject; narrowing the prompt to match an arbitrarily strict
regex is more churn than widening the regex. Needs a spec home (e.g. one
short section covering both this and PENDING-NOTES-CAP-VISIBILITY below,
since both are the same `renderSchemaForPrompt`-vs-`PendingSchema.ts`
drift class) before it can carry a `per` cite.

## PENDING-NOTES-CAP-VISIBILITY: derivation-time prompt never states the notes ≤500-char cap the commit-time gate enforces

**NEEDS AMENDMENT** — fix direction is clear (surface the cap in
`renderSchemaForPrompt`'s notes line); blocked on the same spec-home gap
as TAG-PATTERN-SLICE-CONSTRAINT above.

Drained from inbox (jeff pass, DAL job mining): the `notes` field's
~500-char zod cap is enforced only by the commit-time validator;
`renderSchemaForPrompt` never states it, so plan discovers the cap only
by reverting — two DAL-job ticks did exactly that. Same drift class as
TAG-PATTERN-SLICE-CONSTRAINT, narrower fix: add the cap to the rendered
`notes` line (mirroring however `summary`'s ≤200 cap is already
rendered, if it is — worth checking at fix time).

Recommend folding both this and TAG-PATTERN-SLICE-CONSTRAINT into one
spec entry once a human opens a home for `PendingSchema.ts`
self-consistency fixes.

## SUPERVISOR-PROVISION-FAILURE-QUARANTINE: pre-tick worktree-sweep EBUSY burns a whole `--max` batch, same shape as §4's mount-dead but out of its scope

**PARKED** — two real options with a genuine tradeoff, not a clear
single answer; also no spec section governs this class yet.

Drained from inbox (jeff pass, live batch, M). Batch 3 of the v0.7 loop
burned 12/16 ticks on one deterministic pre-tick `git worktree` sweep
EBUSY (rmdir denied — a Windows external handle-holder, an editor's
tsserver/watcher, on `.flume/worktrees/ship-detection-declared-files-diff`);
every subsequent tick re-hit the identical wall, exited 1, and the
supervisor logged "continuing" twelve times until `--max`. §4 names the
don't-burn-remaining-ticks principle but scopes only the load/mount
chain-failure class (`spec/RELEASE-v0.7.md` §4); a pre-tick
provisioning failure is a distinct class with the same burn shape.
Confirmed in the write-up: delete *and* rename of the held dir are both
denied while a watcher holds it, so a rename-aside fallback would not
have rescued this case — the dir ends up empty-but-held.

Two options, no clear winner:
1. Consecutive-identical-failure abort/backoff at the supervisor —
   generalizes §4's abort principle past the mount-dead class.
2. Per-entry provision-failure quarantine — skip that entry's slug for
   the batch, keep working the rest (6 of 7 queue entries were
   pickable the whole time this incident ran).

Needs a human pick (throughput-preserving quarantine vs. simpler
generalized abort) and a spec section to carry either — no shipped
line owns "supervisor doesn't burn ticks on non-work failures" broadly
enough to include the pre-tick provisioning class. Evidence:
`.flume/loop-20260729.log` tail, 12x EBUSY traces.

## SUPERVISOR-LIVENESS-VS-DROPLASTCOMMIT-OWNERSHIP: `status` can't see supervisor liveness; `dropLastCommit` doesn't check tip ownership before dropping

**NEEDS AMENDMENT** for two of the three drained asks — direction is
clear; blocked on a spec home. The third ask is already implemented,
verified this tick — no gap, no action.

Drained from inbox (jeff pass, incident, owned). Two loop supervisors
ran against one tree at once — the operator relaunched a loop while the
prior batch's supervisor was still alive (pid lived 10:55→12:2x)
because `flume status` read "hibernating" (baton awake-markers only,
not process liveness) and the operator deleted `loop.pid` on a "stale"
assumption with no liveness check of their own. The stale supervisor's
`dropLastCommit` then fired twice on commits it did not own —
`19be056` (its own false ship, coincidentally harmless) and `279bd8b`
(the operator's inbox commit, recovered by cherry-pick). Reflog is the
evidence.

Checked each of the three asks against current source before parking
(per `.claude/rules/collaboration.md`, "inform before parking"):
1. "Loop startup refuses when `loop.pid` names a LIVE process" —
   **already implemented**, verified at `src/cli.ts:731-747`: the loop
   lock probes `process.kill(prior, 0)` and refuses (exit 1) iff alive,
   reclaiming only a dead/unparsable pid. No gap — this incident's root
   cause was the operator deleting the pidfile *before* relaunching,
   which no liveness check of that pidfile can prevent. No pending
   entry needed for this ask.
2. `flume status` should surface supervisor liveness beside awake
   markers (e.g. "awake: build (supervisor pid N LIVE)" vs. "(no live
   supervisor — stale)") so an operator's relaunch judgment reads truth
   instead of inferring it from "hibernating". A `liveLoopPid`-shaped
   probe already exists at `src/job.ts:355` for the job path — same
   pattern applies to the top-level `loop.pid`.
3. `dropLastCommit` (`src/git.ts:55`, called from `src/Dispatcher.ts:609`
   and `:1091`) should verify the tip commit is the one *this*
   supervisor created (sha remembered at its own commit time) before
   dropping, and refuse otherwise instead of dropping blind.

Needs a spec section before asks 2/3 can carry a `per` cite — same
spec-home gap as TAG-PATTERN-SLICE-CONSTRAINT / PENDING-NOTES-CAP-
VISIBILITY above and SUPERVISOR-PROVISION-FAILURE-QUARANTINE above.
Candidate: one v0.8 "supervisor operational safety" home could plausibly
cover all three of this tick's parked questions — they share "supervisor
robustness under concurrency/environment hazards," distinct from v0.7's
"engine truth-telling" theme (§1's declared blast radius doesn't
mention supervisor liveness or worktree provisioning) — human's call.

<!-- none open this tick — all questions closed by spec/RELEASE-v0.7.md or by acting on the research the write-up itself already converged on:

- "PROMPTS-BUILD-FENCE-INSTRUCTION: spec §13's `prompts/build.md`
  instruction has no phase writer" — closed by operator commit `6005318`
  applying the instruction directly (this park's own recommended path,
  precedent `b578a41`), and `spec/RELEASE-v0.7.md` §13 now carries a
  2026-07-29 delivery note confirming the bullet is operator-applied,
  not loop-derivable, and no entry should carry it. No residual work.

- "EXIT-CODE-CONTRACT: entry.files omits the test edits the spec-required
  behavior change forces, and two locked existing assertions directly
  contradict the new contract" — the write-up's own analysis already
  converged on option 2 (split, smaller blast radius) with reasoning, so
  per collaboration.md ("if research yields a clear answer... propose it
  directly, skip the park") this tick acted on it directly instead of
  re-parking: re-filed EXIT-CODE-CONTRACT as abort-only (test edits now
  folded into files per blocker 1) and split the shipped/errored counting
  into a new follow-up, EXIT-CODE-CONTRACT-COUNTS, blockedBy the first —
  its notes commit to a per-tick disk artifact (disk-is-truth) rather
  than a stdio-pipe change, so build isn't deciding that API surface.
- "SHIP-DETECTION-COUNTS-PARK-ONLY-COMMITS: a build commit touching only
  entryChannelPaths gets removed from pending.json as if shipped" — v0.7
  §12 gives this its spec home; filed as SHIP-DETECTION-DECLARED-FILES-DIFF.
  Near-miss confirming the urgency: 19be056 briefly shipped
  EXIT-CODE-CONTRACT off f5b60e1's park-only commit; an operator caught
  and reset it before this tick landed. Ship this one soon.

- (earlier closures, unchanged from prior ticks:)

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
