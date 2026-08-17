# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `shouldRun` can never reconcile a pickable entry whose acceptance already landed out-of-band (inbox, live run + audit)

Status: PARKED

Live incident (inbox, 2026-08-17): `buildpriorattempt-tail-bias-gate-revert-details`'s fix
landed via the verdict-sha recovery flow — `ed737f6` is a direct cherry-pick of `b055697`,
bypassing the dispatcher's normal fanout-merge flow, so pending.json's ship-detection
bookkeeping never ran. The entry sat open and pickable; `shouldRun` (`.flume/chain.ts` ~L358)
returns `true` only when nothing is pickable or the inbox has entries, so a pickable-but-
already-shipped entry defers plan to build indefinitely. Build's agent correctly
voluntary-bails ("acceptance already holds") every tick thereafter, and a voluntary bail
carries no failure signature, so the quarantine brake never fires. Two decline/bail cycles
burned (~75-405s each) before `flume stop` capped the run. This tick's audit reconciled the
immediate case (the stale entry is retired in this commit — same reconciliation already
performed once before, for `test-hermeticenv-strips-tip-claim-held`), but the general
livelock shape recurs each time a recovery cherry-pick bypasses ship-detection, and remains
open.

`shouldRun` is chain-owned by design (`spec/loop.md`, *Declining a tick before the
invocation*: "the chain decides whether a tick is worth spending; the engine supplies the
skip"), and `.flume/chain.ts` sits outside every phase's `writablePaths`
(`.claude/rules/spec-plan-build.md`) — no plan or build tick can make this edit; only an
operator, interactively.

Options (from the inbox finding's own research):
- Widen `shouldRun` to also return `true` when any pickable entry carries a voluntary-bail
  prior-attempt record (a cheap existence/mode check on
  `<flumeDir>/prior-attempts/<slug>.json`, matching the predicate's read-small-files
  contract, `spec/pending.md` *Dispatch reads come from the tip, not the tree*) — build has
  already said "I looked; this is plan's call." Needs no other design work; bounds the whole
  class (any bailed entry gets plan's attention next tick, whatever the bail reason).
- The dal-migration friction note's pre-dispatch acceptance check (incident 14): prevents the
  dispatch instead of recovering from it, but needs the semantic-acceptance design question
  answered first — a bigger fork, not ready to derive.

No recommendation on which — this is an operator-lane `chain.ts` edit either way, but the
first option is markedly cheaper and narrower in scope (no upstream design question to
resolve first).

## `spec/worktrees.md`'s "real git" integration-lane trigger is pervasive in the default lane as literally written (inbox, session)

Status: PARKED

Inbox finding asked for a systematic sweep of the default lane for load-flaky real-subprocess/
timing tests, naming `tests/Dispatcher.test.ts` as suspect. Swept it: the file's shared `exec`
helper (`tests/Dispatcher.test.ts:69`) spawns real `git` subprocesses (`git init`/`commit`/
`checkout` in temp fixtures), used across effectively all ~191 `it(...)` blocks — and the whole
file sits in the default (`.test.ts`) lane. Taken literally, `spec/worktrees.md`'s *The default
test lane must stay fast* names "real git" as one of the two integration-lane triggers
("Integration lane — anything spawning real subprocesses: real flume tick/loop through tsx, real
git"), which would put nearly the whole file in the integration lane — clearly not today's
practice. The one concrete load-flake risk the sweep actually found is a single hard-timing
assertion (filed as `dispatcher-parallelism-probe-timing-flake`), not the git calls themselves —
raw git plumbing on empty temp repos is genuinely fast.

The fork: is "real git" in that section calibrated too broadly, and if so what's the actual
dividing line — subprocess weight, `tsx`-spawned child processes specifically (full Node startup
+ module resolution, much heavier than a `git` plumbing call), a wall-clock budget, something
else? This determines whether a broader sweep of `Dispatcher.test.ts` (or any other default-lane
file using real git) is warranted, versus the one timing-flake being the whole story.

Options:
- Narrow the spec text to name the actual cost driver (e.g. "spawning a subprocess through `tsx`"
  specifically, or a stated per-test wall-clock budget) — would leave `Dispatcher.test.ts`'s
  existing real-git usage already-compliant and close this with no code change.
- Leave "real git" as written and treat `Dispatcher.test.ts`'s pervasive real-git default-lane
  usage as accepted, pre-existing debt — but that reading makes the spec text aspirational
  rather than descriptive of the file it should already govern.

No recommendation — this is a calibration question about intent versus a section's literal
wording, not something research resolves; needs a human read on which failure mode the section
was actually written to prevent.

## A gate-revert whose failing tests are disjoint from the entry's footprint wants a distinct marker (752346f)

Status: PARKED

**Second occurrence (2026-08-17, inbox):** `test-hermeticenv-strips-tip-claim-held`'s span
(8da2af6) was also afterMerge-reverted by a flake disjoint from its own footprint
(`tests/helpers/subprocess.ts`), recovered by hand via the tick verdict's sha. Same shape as
below, independent instance — raises the cost of leaving this parked but doesn't change the
fork.

Inbox finding (752346f): friction-nonenoent-swallowed's first build attempt was afterMerge-reverted
by a flake in `tests/cli.test.ts`'s tip-claim-wiring suite — tests the entry's diff never touched
(footprint: `src/cli.ts`, a different describe block). The `PriorAttempt` record told the retry
"your tests failed" indistinguishably from a real regression, risking an agent mutating correct
code to chase a flake. Proposed marker: footprint ∩ failing-test-file(s) = ∅, called "mechanical...
from facts the verdict already holds."

Checked what the verdict actually holds (`spec/loop.md`, *The tick verdict*, *A reverted tick...
PriorAttempt record*): the `gate-revert` variant carries the gate's `name`/`message`/`details` plus
a `git show --stat` digest of the reverted commit — but `details` is documented as "a digest, not a
transcript," capped and unstructured, not a machine-parseable failing-file list. The proposed check
needs a *structured* failing-file field that doesn't exist today; deriving one by parsing a test
runner's own output would be the engine reconstructing a statement it wasn't given
(`engine-boundary.md`, *Told, not inferred*).

Options:
- Add a `failingFiles: string[]` (or similar) to the gate result shape, populated by whichever
  chain-side mechanism already knows how to parse its own test runner's output — the
  footprint-disjoint marker becomes a mechanical engine-side derivation once that field exists.
- Leave `details` as an opaque digest and treat this as human-in-the-loop only (an operator reads
  `details` before retrying, as the recovery just did) — no schema change, but the marker stays
  manual.

No recommendation — capability-vs-convention fork (`engine-boundary.md`, *Capability vs
convention*): `failingFiles` is machinery only the chain can populate (its own test runner's output
format), not something the engine can derive from an opaque digest. Needs a design pass on where
that field enters the gate-result contract before it's derivable as a pending entry.

## Unexpected trailing positionals are silently accepted on `tick`, `stop`, `check`, and past `wake`/`sleep`'s `<phase>` (gh#1)

Status: PARKED

Inbox report (gh#1): `flume tick plan` with build awake runs build — the positional is neither
honored nor refused. Verified current-surface and widened the sweep the report asked for
(`src/cli.ts`, `main()`'s per-command blocks): `tick` (~1302), `stop` (~1062), and `check`
(~1111) read no positionals at all and never check `rest.length`; `wake`/`sleep` (~1028-1061)
validate a *missing* `<phase>` but not extras after it. By contrast `log`, `friction`, and every
`job` verb (`status`/`rm`/`new`) already refuse on `rest.length > 0` past what they consume —
this is an inconsistency within the surface, not a wholesale gap. `status` is the one deliberate
exception: `spec/cli.md` *Subcommand surface* states it "exits 0 always," so a stray positional
there is spec-compliant as written and out of scope.

The fork is a reading of `spec/cli.md` *Subcommand surface*'s closing line: "Usage-shaped
failures exit 2 uniformly: [enumerated list]... Everything else is the tick/loop exit-code
contract in `spec/loop.md`." A stray positional on `tick` isn't in the enumerated list, which
supports two opposite readings — (a) the list is a closed set and "everything else" routes to
the tick/loop contract, so today's silent-ignore is already spec-compliant, if unintuitive; or
(b) the list enumerates *examples*, and "usage-shaped" is a general category an unexpected
argument to an argument-less command obviously belongs to, with `status`'s explicit "exits 0
always" reading as the one named exception that proves the rule.

Options:
- Reading (b): widen `spec/cli.md` to name "an unexpected trailing argument to `tick`/`stop`/
  `check`, or more than one after `wake`/`sleep`'s `<phase>`" as usage-shaped (exit 2),
  bringing those four in line with `log`/`friction`/the `job` verbs. Smallest change, matches
  existing precedent, and is what gh#1 asked for.
- Reading (a): leave the enumerated list closed and treat this as already-correct behavior;
  document the override explicitly instead (e.g. `docs/CLI.md` noting positionals past the
  recognized ones are ignored).

Recommend (b) — silent divergence from the operator's typed intent is the concrete harm gh#1
reports, and the fix is smaller than the workaround — but the enumerated list reads as
deliberately closed (CLAUDE.md: "never silently fill a gap in a spec"), so the spec text itself
needs a human edit before this is derivable as a pending entry. Once blessed, ships with the
fix ships-the-test discipline: `flume tick <phase>` exiting 2 rather than running a different
phase, and the analogous case for `stop`/`check`/`wake`/`sleep`.

## Cherry-pick conflict parks gated-green work; plain-pick vs. 3-way/ort retry before parking (gh#3)

Status: PARKED

Inbox report (gh#3) with cost data: two observed append-append conflicts, each discarding
800-1500s of gated agent work (~$5-8). The recovery half is already answered — the durability
contract (`spec/loop.md`, *The tick verdict*) records each span's head sha, so a refused span is
re-cherry-pickable on retry, nothing lost permanently, only re-spent. Confirmed the contract is
deliberate, not an oversight: `spec/loop.md`, *Tip verify — one writer per branch, absorption at
the merge* states plainly that on a foreign commit "git's own conflict detection is the arbiter
of content: a conflicting cherry-pick aborts... into that entry's existing `MergeFailure`
outcome" — with "semantic compatibility owned by the `afterMerge` gates... never by a provenance
check" named as the reason.

The fork gh#3 raises: should the engine retry the conflict through a 3-way/ort merge (or
rerere) before parking, auto-landing the append-append class the cost data measured? That would
mean the *engine* deciding content-compatibility for cases plain cherry-pick refuses on but a
3-way merge could resolve — a semantic call the `afterMerge` gates currently own exclusively,
per the section above.

Options:
- Keep plain-`cherry-pick`-then-park (current): simplest, keeps content-compatibility judgments
  entirely in the chain's `afterMerge` gates, zero engine risk of a bad auto-merge landing
  unvalidated.
- Add an ort/3-way retry before park: auto-lands the append-append class (the cost data's
  actual pain), but the retry's result still needs `afterMerge` validation before it's trusted,
  and a 3-way merge can silently produce content neither side wrote — the engine picking a
  merge strategy is itself a content-compatibility decision, the exact line *Tip verify*
  currently keeps on the chain side.

gh#3's suggestion 3 (planner-declared overlap hints to serialize likely-colliding entries across
waves) is chain-side batching policy, not an engine change — separable from this fork, actionable
independently as a `.flume/chain.ts`/plan-prompt change if desired.

No recommendation — this is a real engine-boundary tradeoff (`engine-boundary.md`, *Capability
vs convention*: a merge strategy the engine picks is mechanism, but which conflicts are safe to
auto-resolve is convention the chain currently owns). Needs your call on which side of that line
this sits.

## Intake gate for under-specified job specs, as a chain capability (gh#8)

Status: PARKED

Inbox report (gh#8): proposes rejecting/escalating thin job specs before task derivation
(motivating incident: a one-line spec → keyhole read → ineffective fix → poisoned shared
knowledge base). As proposed to the engine it's convention-shaped — spec-completeness is
semantic judgment over prose the engine never reads (`engine-boundary.md`, *Capability vs
convention*). The boundary-clean shape already posted back on the issue: a chain-declared intake
predicate/phase at job acceptance, where the engine supplies only the refusal mechanics and a
provenance field on the job record (human-authored vs. agent-completed spec); the chain owns the
bar for what counts as "thin."

Landing spot in the existing spec is `spec/jobs.md`, *`flume job new <name>` — seed a state
root*, whose numbered sequence (validate name → require `chain.ts` → validate `seedDir` → mkdir
+ seed → runtime ignores → longpaths → baseline commit) has no step for spec-completeness today
— an intake predicate would need a place in that ordering, and whether it runs before or after
the baseline commit changes what "reject" means (nothing written yet, vs. a commit to unwind).

Needs a design pass before this is derivable: where the predicate slots into the `job new`
sequence, what the provenance field's shape is, and whether the refusal is `job new`-time or a
later `job run`-time gate (the incident was keyhole *derivation*, which happens after `new`).
Not recommending a specific shape yet — this wants the capability sketch worked through against
the numbered sequence above before it is a pending entry.

## Self-upgrade livelock: supervisor-frozen/children-fresh contract hazard (human+session, live derivation)

Status: PARKED

Observed live: `tip-verify-claim-arbitration` shipped mid-loop, so fresh tick children (running
new code) began refusing merges on the live claim held by their own still-running supervisor
(old code, predating `FLUME_TIP_CLAIM_HELD`), reading their own parent as a concurrent engine.
Guaranteed refusal per wave, full agent spend each. Resolved operationally by killing the stale
supervisor (which released the claim) and driving bare ticks to drain.

The general fact behind it is already implied but not stated in `spec/loop.md`, *One tick is one
fresh process*: "between children it re-reads the baton from disk" — each tick child re-reads
HEAD's code, but the supervisor (`flume loop`) stays resident at whatever version it launched
with (`spec/loop.md`, *The loop lock and the tip claim*, *Scope: per run* — the claim is
acquired once for the whole run). Any entry that changes the supervisor↔child contract (the tip
claim shape here) is unsafe to ship under a live old supervisor, because the supervisor half of
the contract is frozen at launch while the child half updates every tick.

Two separable questions:
1. **Same-derivation ordering.** This run's derivation shipped the refusal-semantics entry
   before `tip-claim-per-run-scope`, the entry that makes them safe under a live supervisor — a
   dependency invisible except under a live self-upgrade. Is this expressible on `pending.json`'s
   existing `blockedBy` gate (it already models "must ship after"), or does it need a new
   same-derivation-coupling concept, or is it simply a plan-prompt/PROTOCOL judgment call
   ("when deriving a contract change, check whether an in-flight supervisor could be running the
   pre-change half") rather than a schema addition?
2. **The general contract.** Should `spec/loop.md` state a supervisor-upgrade rule explicitly —
   e.g. the loop finishes its run on the contract it started with (child version-pins, or the
   supervisor self-restarts at a version fence) — or is "operator restarts the loop after any
   contract-touching ship" the accepted operational fact, documented rather than engineered
   around?

No recommendation on either fork — (1) is a plan-mechanics question, (2) is an engine-boundary
question about how much self-upgrade safety the engine should own mechanically versus leave to
operator discipline. Needs a design pass on both before anything is derivable.

## `src/cli.ts` mixes several independently-testable concerns in one 1500-line module

Status: PARKED

Sweep finding (posture pass over `src/cli.ts`, posture-sweep.md's "a module carrying jobs that
want separate homes" lens): the file combines pure help-text content (`HELP_TOP`, `HELP_SUB`,
`HELP_JOB`, ~280 lines of string literals), state/job-path resolution
(`resolveStateDirs`/`resolveRepoRoot` plus their conflict-error types), exit-code/verdict
formatting (`tickExitCode`/`loopExitCode`/`loopCompletionSummary`/`formatTickVerdictLine`),
job-verb dispatch (`runJobVerb`, which mostly forwards into `job.ts`), and the argv/subcommand
switch in `main()`. Several of these are already imported piecemeal by tests reaching past the
file's own boundary (e.g. `tests/Dispatcher.test.ts` imports `loopExitCode` directly from
`../src/cli.ts`), which suggests the seams already exist structurally even though the file
doesn't.

Options:
- Leave as one module — `cli.ts` is the CLI's front door; a single entrypoint file is a
  defensible norm, and size alone isn't a defect if nothing about it hides behavior.
- Split along the four seams above (help text, state/job resolution, verdict formatting,
  job-verb dispatch), keeping `main()`'s argv switch as the thin remaining `cli.ts`.

Recommend the split — a test already reaching past the module boundary to import an internal
helper is usually a sign the boundary is drawn in the wrong place — but this touches every
command's import path, so wants a human call on scope and sequencing before it becomes a
pending entry (or a set of them).

## Harvested chain-preset layer

Status: PARKED

Inbox proposal (2026-08-05, human, + same-day verification addendum): consumer chains (this
repo's 480-line `.flume/chain.ts`, temper's 761-line one) converge by copy instead of
construction, so fixes and defects both propagate by hand. Proposal: a versioned, CI-tested
chain-preset package, harvested (not invented) from the verbatim intersection of the two real
chains, with an escape hatch per piece and the bare-`ChainFactory` path staying first-class.

This is architecture, not a shippable unit — new package, versioning story, two-repo
dogfooding commitment. The addendum already flagged the open constraint worth settling first:
every exported piece must be API-parameterized (take `FlumeApi`/its values as arguments, import
no engine *values*) or a walk-up-resolved second preset copy reintroduces the dual-engine split
the factory shape removed by construction (`spec/chain.md`, *The chain is a plugin, not a
consumer*). Recommend the proposal's own suggested first step — diff-and-extract the agent
stack + entry extension + park predicates as individually exported pieces, no wrapper yet, port
both dogfood chains onto them — as a scoped research spike before anything bigger. Needs your
buy-in to start.

**Answered (2026-08-05, human sign-off via interactive session):** the kill-switch first step
is approved as scoped above — diff-and-extract with API-parameterized pieces only (no engine
value imports; the addendum's constraint is binding), no `presetChain` wrapper, no packaging
decision. The packaging/home fork (subpath vs sibling package, versioning story) stays parked
pending the residual-diff verdict. **Not derivable yet**: the port-proof half needs the temper
repo, and scheduling that cross-repo work is operator-owned — plan should hold this out of
`pending.json` until the operator opens the window, deriving only the in-repo extraction when
that happens.

## `cherry-pick --abort` discards bystander uncommitted state on the primary checkout

Status: PARKED

Found while building `shared-checkout-keep-reset` (per `spec/loop.md`, *Tip verify*, "dropping
it must not take bystanders"), which converted the primary-checkout **afterMerge-gate-revert**
leg (`git.hardResetTo(repoRoot, preCherry)` → `git.resetKeepTo`, keep-semantics, refuses loudly
on a textual collision) — a distinct, still-open leg surfaced during that work: the
**cherry-pick-conflict** leg. Both `Dispatcher.runSingleton` and `Dispatcher.runFanout` call
`git.cherryPickRange(repoRoot, ...)` directly against the primary checkout, and on any failure
call `git.cherryPickAbort(repoRoot)` (bare `git cherry-pick --abort`) unconditionally.

Measured directly (not inferred): if the primary checkout carries *any* staged bystander
change — an entirely new staged file, or a staged modification to a tracked file, whether or
not the path overlaps the entry's own span — `git cherry-pick <range>` itself refuses up front
("your local changes would be overwritten by cherry-pick"), which is loud and safe on its own.
But the dispatcher's unconditional follow-up `cherry-pick --abort` then **discards that staged
content**: a newly staged file is deleted outright; a staged modification to a tracked file is
reverted to the file's last-committed content. Neither is a textual collision with the entry's
own span — the abort wipes bystander state the cherry-pick itself never touched, the same class
of harm §*Tip verify* names for the afterMerge-revert leg, on a sibling code path this entry's
fence (`src/git.ts`, `src/Dispatcher.ts` scoped to the afterMerge-revert call sites) didn't
cover.

Options:
- Extend keep-semantics to this leg too: before `cherryPickAbort`, checkpoint or refuse instead
  of aborting blind — plausibly the harder case, since a cherry-pick abort mid-sequencer-state
  has no `--keep` equivalent in git's own vocabulary; the primitive that mechanism would need
  doesn't exist off the shelf the way `reset --keep` did here.
- Scope it separately: this leg is conceptually the same defect family but a different
  mechanism (`cherryPickAbort` vs. `hardResetTo`/`resetKeepTo`) and a different trigger (a
  staged bystander change at cherry-pick time, not a textual collision at gate-revert time) —
  likely its own entry rather than a late addition to this one.

Recommend the second: file a new pending entry citing this section, scoped to
`git.cherryPickAbort`'s callers on the primary checkout, once a design for the mechanism is
decided (the first bullet is the open design question a new entry would need answered).

## `job.ts`'s `countFrictionFiles` silently treats any readdir failure as zero, diverging from the file's own `readPendingLoose` precedent (sweep, src/job.ts)

Status: PARKED

Sweep finding (`src/job.ts:393-406`): `countFrictionFiles` catches any `readdirSync` error
(ENOENT, permission-denied, a too-long path) and returns `0`, doc-commented as "0 when `dir`
is absent or unreadable." The same file's `readPendingLoose` (`:408-434`) does the opposite for
the analogous case — rethrows non-ENOENT, citing `engineering.md`'s "Loud or nothing" at length
— so a corrupt/unreadable file never silently reads as empty. `countFrictionFiles` feeds `flume
job status`'s friction count, which is informational (doesn't gate pickability or fanout), but
could silently report "0 friction notes" when the real cause is a permission or path error.

Options:
- Mirror `readPendingLoose`'s ENOENT-only catch, giving `jobStatus` a `null` (unreadable) vs
  `0` (empty) distinction for `frictionCount`, consistent with how it already handles
  `pending: null`.
- Leave as documented, accepted behavior — `frictionCount` is purely informational, so a silent
  0 has no correctness consequence beyond a misleading status line.

No recommendation — this is a shape/consistency question about how far the "loud or nothing"
bar reaches into a non-load-bearing informational path, not something research resolves.
