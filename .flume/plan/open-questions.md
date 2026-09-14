# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## The release publish is hand-run, and `spec/cli.md` ratifies that (PARKED — needs a spec amendment)

Drained from the inbox (2026-09-08, human via flume-main). 0.14.0's publish
stalled a day on a dead token: CLAUDE.md named a key `.env` did not hold, the
key it did hold had expired in May, and `pnpm publish` ignored the env-var auth
form and read `~/.npmrc`, surfacing as a 404 on the PUT. Tag and commit were
already pushed, so the registry lagged the tag by a day.

**Not derivable as filed.** `spec/cli.md` *Versioning policy* currently states
"The version bump and `npm publish` are human-performed at cut time." A tagged
CI publish contradicts that line, so the line moves first.

Shape the finding proposes, carried here so the answering session need not
re-derive it — temper's `.github/workflows/release.yml`: `on: push: tags:
["v*"]`, publish with `secrets.NPM_TOKEN` through `setup-node`'s
`registry-url`, **idempotent** (skip when `npm view <pkg>@<version>` already
resolves), and a post-publish smoke that installs the published tarball from
the registry and runs the shim — `scripts/smoke-install.mjs` already does this
against a local pack; the job points it at the registry.

Two things are the operator's regardless of the ruling: setting the repo
secret, and whether release automation is wanted at all for a package whose
cut is deliberately hand-curated (changelog mining, `smoke:install`).
`.github/**` is already inside build's fence, so the work ships the moment the
spec line moves.

## The runtime ignore list has three unpinned copies (PARKED)

Was "The `spec/jobs.md` ignore block names a retired file, `last-tick.json`";
the stale name closed at `1ebf971` (`tick-verdict.json`), and `RUNTIME_IGNORES`
(`src/job.ts`) already carried the live name, so spec and code agree. The fork
that ship raised is what remains, drained from
`RUNTIME-IGNORES-NAMES-THE-TICK-ARTIFACTS`'s note.

**Pinning is off the table.** The equality pin on `docs/CHAIN-AUTHORING.md`'s
copy left with the hygiene suite at `bd75f27`, and that commit forecloses
re-authoring it — prose read against code is harness governance, held by its
authors, never promoted into the suite (`.claude/rules/engineering.md`,
*Narration is the ladder's bottom rung*, last bullet). So the list stands in
three unpinned copies — `spec/jobs.md` *Runtime ignores*, `RUNTIME_IGNORES`
(`src/job.ts`), `docs/CHAIN-AUTHORING.md:133-135` — and nothing mechanical
catches the next stale name. The one just amended is what an unpinned copy
does. The fork is which copy stops existing:

- **Shrink the doc's copy to a pointer** at `spec/jobs.md`, *Runtime ignores*.
  Prose pointing at prose — no pipeline inversion, inside build's fence, files
  as an ordinary entry. Leaves spec and `RUNTIME_IGNORES` as the two copies the
  ruling hands to their authors.
- **Shrink the spec's copy to a pointer** at `RUNTIME_IGNORES`
  (`.claude/rules/engineering.md`, *Derived state is computed, never restated
  beside its source* — "in artifacts, the same bar"). Against it: the spec is
  upstream of the code here, so a spec section citing `src/` inverts the flow
  `spec-plan-build.md` rests on, and the section stops being readable standing
  alone.
- **Accept all three, author-held.** The ruling's own posture; costs the next
  stale name.

**Recommend the first** — it removes a copy at no cost to the pipeline's
direction or the section's readability, and leaves exactly the spec↔code pair
the human already maintains. Parked rather than filed because the choice is
among three homes, not one mechanical fix.

The loose end this question carried — this repo's `.gitignore:11` ignoring
`.flume/last-tick.json`, a file no tick writes — now rides
`HARNESS-RUNTIME-IGNORES`, whose derived consumer-root set names no such line.
That entry adds no fourth copy: it derives from the engine's path record.

## `docs/INTENT.md`'s quality-lenses decision has a fired arming condition (PARKED)

Drained from `INTENT-DOC-RECONCILED`'s note; verified on disk. The
"Decided, not yet executed — quality lenses in the loop" section closes with
"Sequencing: arm after the v0.11 boundary line ships" (`docs/INTENT.md:67`).
`package.json` is `0.14.0`, so the stated gate fired two lines back while the
decision stayed unexecuted. The prose therefore reads "not yet due" when it is due —
`engineering.md` *Narration is the ladder's bottom rung*, **Prefer the condition to
the era**, firing on a live section rather than a dead one.

The release line was never the real gate. The section names its own blocker one
paragraph up: the correctness-adjacency filing bar "demotes exactly the findings
these lenses produce", and the fork it poses — a quality lane that batches pure-shape
debt into a dedicated wave, or a bar carve-out for reuse findings — is unresolved.
That is the condition; `v0.11` was the era standing in for it.

Options:

- **Arm it.** Resolve the filing-bar fork, then add `reuse` and `efficiency` sections
  to `.claude/rules/engineering.md`. A phrase delta then arms a full-domain posture
  rotation and the loop gains the lenses with no engine or chain change — the
  section's own claimed mechanism. Costs one full rotation of sweep ticks.
- **Restate the condition** (recommended minimum). Replace the release-line sequencing
  with the filing-bar fork it was standing in for, so a later reader evaluates
  something observable. Ships as a pending entry the moment the replacement wording is
  ruled — `docs/` is inside build's fence.
- **Retire the decision.** The ruling is from 2026-07-31 and three release lines have
  passed without it; if the lenses are no longer wanted, the section goes and git keeps
  the record.

Parked rather than filed because arming, restating and retiring are three different
answers about whether the lenses are still wanted, and the section is a design-intent
ruling — plan choosing among them would be filling a gap silently.

## A contract-touching entry ships mid-run with no ordering and no signal (PARKED)

Drained from the inbox (2026-09-11, human). Loop of 2026-09-11, 15 ticks:
`QUARANTINE-KEYS-THE-ENTRY-AS-READ` shipped at wave 6 and re-keyed
`FLUME_QUARANTINED_SLUGS` from a bare slug to `slug@hash`. The resident supervisor
kept sending the old form; wave 7's fresh children compared it against the new key,
matched nothing, and re-picked two entries quarantined "for the rest of this run".
Harmless here — both merged — but it is `spec/loop.md` *A run finishes on the
contract it started with* failing with no signal at all, and the key is documented as
an opaque equality key "never parsed apart by either side of the channel"
(`src/Dispatcher.ts:869`), which is exactly why neither side can notice the skew.
Observed at `bec94406`.

**`.flume/PROTOCOL.md` rule 6 does not reach it.** Rule 6 orders an entry against *the
entry that completes the contract's other half*. Here there is no other half: the
change is complete in one entry, and its effect is simply deferred to the next run.
Plan filed nothing because nothing in the rule told it to.

Options, in rising cost:

- **Say it in the rule.** Rule 6 gains the single-entry case — an entry changing a
  supervisor↔child contract with no paired entry carries a note that its effect lands
  at the next run start. Prose, one `chore(flume):`, zero mechanism, and one forgetful
  plan tick from being nothing.
- **Mechanize on existing surface**, which `spec/loop.md` sanctions in the same
  paragraph ("a chain may mechanize this … its build handoff writing the stop flag
  after shipping an entry plan marked contract-touching"): this chain's
  `entryExtension` gains the flag and `build.handoff` writes the stop flag when a
  shipped entry carries it. Chain-side only, no engine change; costs a relaunch per
  such ship, which is the point.
- **Engine fence.** The spec names its own arming condition — "a second livelock
  despite the documented rule" — and this was not a livelock, so by the spec's own
  terms it has not fired.

**Recommend** the second: it is the mechanism the spec already points at, it lives
entirely in `.flume/chain.ts` plus the extension declaration, and it degrades to the
first when the flag goes unset. Parked rather than filed because both edits are
human-only — `spec/`, `.flume/PROTOCOL.md` and `.flume/chain.ts` are outside every
phase lane.

## Two shapes of named line the vitest gate cannot judge, and nothing warns at plan time (NEEDS AMENDMENT)

Drained from `CASCADE-SHOULDRUN-FROM-DISK`'s park (2026-09-11 build wave); verified
on disk. The build gate runs `vitest run --reporter=json` (`.flume/chain.ts:768`) —
the **fast** lane, and `vitest.config.ts` excludes `*.integration.test.ts` from it.
So a `tests[]` line whose only passing test lands in `tests/*.integration.test.ts`
is absent from the gate's report, and the entry reverts with "N of N named
behavior(s) have no passing test" no matter how green the work is. That is exactly
what cost this entry a wave: plan declared the decline case against
`tests/examples.integration.test.ts`, which the gate cannot see.

**Nothing warns at plan time.** `.flume/prompts/plan-discipline.md`
(*Tests ride the entry, and the gate reads them*) says "the file a test lands in is
build's call" — true, and the constraint the sentence omits is that the call is
bounded to the fast lane. No check can read the *test file*: it does not exist when
plan derives.

**A second shape, same paragraph, drained from
`EXAMPLES-INTEGRATION-API-PATHS-ARE-THE-TICKS`'s park (2026-09-14 build wave);
verified on disk.** An entry whose `files` are *all* test files can carry no
judgeable `tests[]` line either, in any lane. Red-on-base checks the base out
detached and lays the merged commit's bytes for **the files holding the named
tests** over it (`.flume/vitestJudge.ts`, *red on the base*) — for a tests-only
entry that is the entire diff, so the named test passes at the base by
construction and the gate reverts with "already pass on the base". The
condition is not the lane but the overlap: a `tests[]` line is judgeable only
when the entry also changes a file that is *not* among the ones holding it.

**Recommend** one clause in that paragraph covering both — a `tests[]` line
names a behavior a **fast-lane** test can carry **and** that some non-test file
in the same entry changes; work with neither property (an integration-only
home, or a tests-only diff) declares its named behavior over the fast-lane
surface it exposes, or carries no `tests[]` line at all. **The fast-lane half
binds `pins[]` identically**: `vitestOnCode` judges `[...named, ...pinned]`
against the one fast-lane report (`.flume/chain.ts:834`), so moving a line to
`pins[]` drops the red-on-base requirement and nothing else. No fork, no
mechanism, one `chore(flume):`. Parked only because `.flume/prompts/**` is
outside every phase lane.

**Reported independently from the field** (inbox, 2026-09-11, human), which
names the alternative and rejects it: the `vitest` gate could run the
integration lane whenever an entry touches `examples/` — a second full suite
per merge, paid on every such entry to buy a lane the fast one already
exposes. The prose clause above stays the right default.

**A third field instance, and one correction to the paragraph above**
(`EXAMPLES-GROOMER-CAPTURE-ROOTS-AT-FLUMEDIR`'s note, 2026-09-14 build wave;
verified on disk). The entry declared both behaviors against
`tests/examples.integration.test.ts`; build shipped them to
`tests/examples.test.ts` and merged green. So the lane wall costs a wave only
when build follows the prediction — but plan is still writing predictions that
name a revert, three waves running.

**A fourth field instance, and it corrects the `pins[]` remedy**
(`TIPCLAIM-INTEGRATION-DERIVES-CLAIM-PATH`'s note, 2026-09-14 build wave;
verified on disk). The entry's `pins[]` line was declared against the
integration file its `files.edit` named, and could not live there: a pin whose
only test sits in the excluded lane reverts with "N of N named behavior(s) have
no passing test", exactly as a `tests[]` line does. Build relocated the case to
`tests/cli.test.ts` (`--max 0` loads no chain, so the lane stays fast) and
merged green. `pins[]` was never an escape from the lane, only from
red-on-base; the clause above now says so, for both fields.

**The prediction is the plan-time signal, and it is decidable.** The test file
is unknowable at plan time; the entry's declared `files` is not, and
`pendingGate` already pre-checks every `files` path against `buildFence`
(`.flume/chain.ts:730`). A path matching the lane `vitest.config.ts` excludes
is a literal string in the queue plan just wrote. Two homes, both chain-side,
both `chore(flume):`:

- **The `tests[]` hint** (`.flume/chain.ts:139`, chain-authored, injected into
  plan's schema block) gains the lane clause, and the `pins[]` hint (`:148`,
  currently "judged green, never red on the base") gains its fast-lane half —
  that hint is what read as a lane escape. Reaches plan at authorship, costs
  nothing, refuses nothing.
- **A second plan gate** reading the committed queue and failing an entry that
  names both a `tests[]` line and an `*.integration.test.ts` path in `files`.
  Against it: `files` is a prediction build is not held to
  (`spec/pending.md`, *`files` is a prediction the scheduler consumes*), so
  this entry — which shipped fine — would have had its plan commit reverted.
  A gate that refuses a correct queue over a prediction build ignored is the
  wrong rung.

**Recommend** the two hints, alongside the plan-discipline clause already
recommended above; the two surfaces say one thing in the two places plan reads.
Held here rather than filed because `.flume/chain.ts` is outside every phase
lane.

**The plan-time half now has its mechanism, and it is in the package**
(`HARNESS-VITEST-RUNNER`'s note, 2026-09-14 build wave; verified on disk).
`Runner.lanes` shipped with the runner interface (`harness/runner.ts:102`);
`spec/harness.md`, *The runner interface* says outright why it exists — "so the
judge can refuse at plan time a line homed in a lane it will not run, instead of
at build time after a wave". Nothing reads it yet: `tests/harnessRunner.test.ts:175`
is its only consumer, because the judge that would read it is unfiled.

So the recommendation above splits, and only one half is still parked. The
**lane** half is no longer a chain-side hint waiting on a fence widening — it is
a package judge this queue can file, once `HARNESS-DECLARATION-SCHEMA` lands and
a declared `runner` is reachable from the chain factory. The **overlap** half
(a tests-only diff is red-on-base-proof by construction, whatever the lane) has
no lane to read and stays a `plan-discipline.md` clause, outside every phase
lane.

## A tick that commits nothing dies with its worktree, seen by nothing (PARKED)

Was "A worktree torn down with uncommitted tracked edits reads as merged";
the committing leg is answered and the question narrows to the other one.

**Answered, chain-side** (`cde9ae2`, interactive session). `cleanTreeGate` in
`.flume/chain.ts:339` runs `afterCommit` on build and every plan slice: it
reads `git status --porcelain` at the worktree root and refuses on any tracked
modification or deletion, or any untracked file inside the phase's fence,
naming each. Pinned in `tests/chain.test.ts:729`. That covers the observed
incident (`2ef648c`) exactly and loudly — the tick reverts with the paths in
its prior-attempt record.

**Unreachable by it.** `afterCommit` gates run only on the committed branch:
`src/Dispatcher.ts:1965` (singleton) and `:3282` (fanout, comment "No commit,
no gate"). A tick that edits tracked files and commits nothing runs no gate at
all; `teardownWorktreeInstance` (`src/worktrees.ts:226`) removes the worktree
and the edits go with it. No chain surface ever sees that tree — a gate is the
only hook with `repoRoot`, and it does not fire. The harvest cannot cover it
either: bounded to files untracked at the worktree's HEAD inside the friction
channel (`spec/worktrees.md`, *Teardown harvest*), a bound that is load-bearing.

**Why the corpus doesn't settle it.** `spec/loop.md:283` ratifies the loss for
a *refused* tick — the reset runs "inside the tick's worktree, which teardown
removes along with any uncommitted work; no snapshot is taken". A voluntary
bail is not a refusal, and no sentence covers it. *Crash equals stop* asserts
"**No engine mutation destroys uncommitted state it did not author**", scoped
in its own text to the shared checkout; in a worktree the engine authored the
tree but not the edit. Principle and carve-out meet here.

Options, narrowed to this leg:

- **Engine reports the fact.** Read `git status --porcelain` in the worktree
  after the agent exits and before teardown, on every tick — committed or
  not — and put the modified tracked paths on the tick verdict. The engine
  states a fact, the chain decides what it means (`engine-boundary.md`,
  *Routing rule*), and it is the only option that makes this leg observable.
  Costs one `git status` per tick per worktree. `spec/loop.md:283` has to
  widen: reported is not preserved.
- **Nothing; ratify the silence.** Say in *Teardown harvest* that tracked
  edits left by a non-committing tick die with the worktree by design.
  Cheapest, and it leaves a clean bail standing over work that no longer
  exists.
- **Widen the harvest** to relay uncommitted modifications out. Recommend
  against, unchanged: it breaks the tracked-at-HEAD bound, and a working-tree
  diff is not a file to deliver.

Recommend the first: the fact on the verdict is what makes the leg visible at
all, and the refusal it feeds is already built — `cleanTreeGate` would need
only a fact to read instead of a `git status` to run.

Parked, not filed: an entry here ships against `spec/loop.md:283` as it reads,
and `spec/` is the human's alone.

## Nothing arms on a `docs/` claim that drifted out of `src/` (PARKED)

Drained from `WAKE-SLEEP-CHAIN-LOAD-REPORTED`'s note; verified on disk.
`docs/CLI.md` § `flume wake` / § `flume sleep` read "No chain is loaded and the
phase name is not validated against the chain" / "the chain is not consulted"
— false since `chainRefusesPhase` landed, and the doc never followed. Build
corrected it in the same commit.

**This is the second instance of one class, and the first one's closure is
void.** The identical sentence, one subcommand over — `docs/CLI.md`'s `flume
job status` paragraph asserting no chain load while the code took one — was
dismissed under *The degraded chain load also rebases the pending count* above
on the ground that `7367b79`'s spec-restatement lens had removed the
generator. `bd75f27` then deleted that lens ("the `spec/` lens leaves
posture-sweep.md"). I have removed the dead paragraph; this section replaces
it.

**The gap, stated mechanically.** `posture-sweep.md`, *The frontier is
decidable; the neighborhood is judged*: a code delta puts touched modules in a
frontier whose domain is `src/`, `tests/`, `bin/`, `examples/`. `docs/` widens
in for the **retired-claim delta alone**, which fires on a `spec/` deletion.
Both instances drifted out of `src/`, never out of `spec/`. So a behavior
change in `src/` that strands a `docs/` claim arms nothing, in either
direction, forever. The exit-code and side-effect sentences are the exposed
surface — eleven subcommand sections of them, each a restatement of behavior
`spec/cli.md` and `src/cli.ts` own between them.

Options:

- **Widen the sweep's arming.** A code delta touching `src/` also puts
  `docs/`'s current-reference pages in the frontier. Simplest, and reuses
  machinery that exists. Costs: `docs/` read on nearly every rotation, for a
  lens that is judged rather than decidable — the opposite of what makes the
  frontier cheap.
- **Pin the exit codes, bounded by the real run** (recommended). Extend the
  shape already standing at `tests/cliHelp.test.ts:157`: it derives its
  expected clause from a real `flume` invocation and asserts `docs/CLI.md`'s
  section names it. That is an agreement gate driving the real producer
  (`engineering.md`, *A seam gate reads what the real writer wrote*), not
  prose read against prose, which is why it survived `bd75f27`. Scoped to
  observed exit codes only — nothing about the prose sentences. Ships as an
  ordinary entry the moment it is ruled; `tests/` and `docs/` are both inside
  build's fence.
- **Accept the drift.** `docs/` is author-held reference prose, which is
  `bd75f27`'s own posture. Costs the next stale claim, and the class has now
  recurred three times in five days.

**Half of this is ruled already.** `862e94b` carved shipped `.d.ts` prose out
of the ladder's harness exclusion, so a scan over a doc comment the package's
`exports` map reaches is settled engine surface (`engineering.md`, *Narration
is the ladder's bottom rung*); that leg's question closed under `09a08ae`, and
`tests/docComments.test.ts` grows under the carve-out. `docs/` is what stays
unruled — the package ships it, no `.d.ts` reaches it, so the carve-out does
not cover these pages. `tests/cliHelp.test.ts:157` is the distinction that
would answer it: an expectation derived from a real run is an agreement gate;
a hand-authored one is the door `bd75f27` closed.

**Third instance, and it sharpens the fork.** Drained from
`SETUPWORKTREE-SCOPED-TO-BOTH-CONCURRENCIES`'s note and verified this tick:
five more `docs/` sites still scope worktree machinery to fanout — an
`afterCommit` gate's cwd, the worktree base dir, `flume job rm`'s prune, the
supervisor's provisioning net, the state-root listing. The residue is
drainable and is filed as `SINGLETON-WORKTREE-PREMISE-IN-REMAINING-DOCS`; the
arming gap is what stays open.

What is new is *how* this one drifted. The first two stranded a `docs/` claim
by a `src/` behavior change with no spec motion at all. This one has spec
motion — but of the wrong sign: `spec/worktrees.md` **gained** *Singleton runs
in a worktree*. Nothing was deleted, so the retired-claim lens, which reads
the spec diff's deleted lines, sees nothing. That adds a fourth option,
cheaper than re-reading `docs/` every rotation:

- **Read the spec diff's added lines too.** An added spec sentence strands a
  `docs/` claim the same way a deleted one does — it contradicts the claim
  instead of abandoning it. Same machinery as the retired-claim lens, same
  decidable arming, same "no hits closes the delta in one tick" bound. It
  does **not** reach the exit-code sentences, where `spec/` never moved in
  either direction, so it narrows this fork rather than closing it.

Parked rather than filed because widening the sweep, pinning, and accepting are
three answers about how much harness prose the mechanism should hold — a
governance ruling `engineering.md` says the ladder does not administer, and
`bd75f27` was taken under explicit operator direction. Plan picking one would
re-open it silently, which is how the first instance got closed on a premise
that no longer held.

**Fourth instance, and the exit-code sentences are confirmed stale.** Drained
from `CLIHELP-TICK-EXITCODES-HAND-COPIED`'s note; verified on disk this tick.
`docs/CLI.md` § `flume tick` names `0`, `69` and `1`, and names neither `2`
(a stray trailing positional, or the CJS-context refusal) nor `78` (terminal
misconfiguration) — both of which `flume tick --help` documents and
`tests/cliHelp.test.ts` now pins against a real `tickExitCode` range. So the
surface this question called exposed is no longer hypothetical: one of the
eleven sections is already wrong, in the direction that reads as complete.
The recommended option is unchanged, and its cost is now one section's diff.

**One condition on whichever pin ships.** That entry's first cut was green
over the same defect in a new costume: its candidate table left several
`TickOutcome` fields `ABSENT`-only, so a `tickExitCode` that grew a branch on
one of them still agreed with the help text. The shipped test gives every
field a present candidate and says so at the site. A pin that drives the real
writer is not done until it has been shown red on a one-sided change —
verified, not assumed.

**Fifth instance, and one arm of the fork is now demonstrably cheap.** Drained
from `HELP-ABORT-THRESHOLD-IS-OVERRIDABLE`'s note; verified on disk this tick.
`docs/CHAIN-AUTHORING.md`'s `abortThreshold` bullet closes "Default 3." It is
*true* — so no arming lens would have fired on it in either direction, and it
is not a fifth stale claim but a live copy nothing holds.

What it changes is the cost estimate. Every instance above restates behavior
whose source is a run's output, which is why the recommended option needs a
real invocation and a candidate table kept honest. This one's source is a
constant: `DEFAULT_ABORT_THRESHOLD` (`src/loopSupervisor.ts`), which
`src/cliHelp.ts` interpolates and `tests/cliHelp.test.ts` already imports. The
pin is one assertion that the bullet's number is that constant — the same
agreement shape at a fraction of the exit-code pin's weight, with nothing to
drive and nothing to keep sensitive. It is still a test reading `docs/` prose,
which is the door `bd75f27` closed outside the `.d.ts` carve-out, so the
ruling is unchanged; only the price of one option moved.

The census, for whoever rules: three prose copies of this number remain.
`src/Phase.ts`'s was `.d.ts`-reachable, inside the carve-out, and is gone
(`3ba6838`). `spec/loop.md` and `spec/chain.md` carry it as the human's own
surface, which the ladder does not administer. `docs/CHAIN-AUTHORING.md` is
the only one this question governs.

**Sixth instance: the same file, a second default, and the boundary is now
drawn twice.** Drained from `QUARANTINESCOPE-DEFAULT-GETS-A-HOME`'s note;
verified on disk this tick. `docs/CHAIN-AUTHORING.md:1501` opens
`quarantineScope`'s bullet with `` `"run"` (default) ``, twelve lines above
the `Default 3.` the fifth instance names. Both are true; neither is held.

Two ships have now retired this exact restatement from `src/Phase.ts` —
`3ba6838` for the number, `d0f457b` for the marker — and neither touched the
guide. So the boundary those commits drew is confirmed, not incidental:
**compiled surface, not every doc that quotes a default.** The census
generalizes with it — `spec/chain.md:337` carries `quarantineScope ?? "run"`
as the human's own surface, and `docs/CHAIN-AUTHORING.md` is again the only
copy this question governs.

What is new is a wrinkle in the cheap option's shape. The `.d.ts` pins are
**absence** assertions (`tests/docComments.test.ts`: the hover text names no
default at all), and absence is the wrong bar for a guide — a chain-authoring
page that omits the default reads worse, not better. The guide's pin would
have to be **agreement**: the bullet's literal equals `DEFAULT_ABORT_THRESHOLD`
/ names `DEFAULT_QUARANTINE_SCOPE`'s member. That is still one cheap assertion
apiece against a real constant, and still a test reading `docs/` prose, so the
ruling stands unchanged — but whoever rules should know the two surfaces want
opposite pins, and that a single "pin the guide's defaults" entry therefore
covers both bullets in one shape.

## Whether the engine's agent passes `--strict-mcp-config` (PARKED)

Drained from the inbox (2026-09-14, consumer-chain survey); verified on disk
this tick. `claudeCode` (`src/Agent.ts:175`) spawns `claude -p` with fixed
flags plus the chain's `extraArgs`; nothing passes `--strict-mcp-config`, so
an autonomous tick boots every MCP server the operator's own configuration
names. One consumer (`docs/surveys/consumer-chains/consumer-a.md` §2, §7) adds
the flag to every agent after a wedged MCP child held a finished agent's
process open and stalled a whole fanout wave.

`.claude/rules/platform-facts.md`, *A headless `claude -p` inherits the user's
MCP servers*, records the fact and the interim — "until it does, a chain
passes it in `extraArgs`" — and defers the engine question to here.

**Both sides have a precedent in the adapter.** `spec/chain.md`, *Per-phase
agent assignment*: "`extraArgs` remains the passthrough for every other flag;
the engine types the one knob every consumer varies per phase and declines to
mirror the rest of the CLI" — which argues the engine stays silent. Against
it, the same adapter already emits one opinionated flag by default
(`dangerouslySkipPermissions: true`), and by-user runtime state under
`~/.claude/` is precisely what a stateless tick exiles
(`.claude/rules/memory.md`).

Options:

- **Pass it by default**, with an opt-out on `ClaudeCodeOptions` — "a tick
  loads only the MCP configuration the chain hands it", as mechanism. Changes
  behavior for every consumer on upgrade, including any deliberately relying
  on an inherited server.
- **Type it as an option, default off.** No behavior change; one more flag
  mirrored, which the spec sentence declines.
- **Engine stays silent** (cheapest; ships as an ordinary entry the moment it
  is ruled): the `claudeCode(opts)` recipe at `docs/CHAIN-AUTHORING.md:892`
  carries `extraArgs: ["--strict-mcp-config"]` and says why, so the opinion
  ships by name (`.claude/rules/engine-boundary.md`, *Surface, not
  prescription*).

Parked because the first option changes a shipped default's behavior, and the
third pre-empts it by teaching the workaround as the answer.

## A differential gate has no base tree, so it provisions its own (PARKED)

Drained from the inbox (2026-09-14, consumer-chain survey); verified on disk
this tick. `GateContext.baseSha` names the span's base; nothing hands a gate a
tree at that sha, and `FlumeApi`'s git helpers are `showNameOnly` and
`readFileAtRef` alone (`src/flumeApi.ts:184`). One consumer's `afterMerge`
drift gate (`docs/surveys/consumer-chains/consumer-b.md` §2, §3 #12) runs `git
worktree add --detach <tmpdir> <commitSha>^`, reports both sides, subtracts
the inherited set, and carries its own `finally` cleanup that swallows
failure. The engine owns worktree provisioning and naming; the gate rebuilt a
copy in `tmpdir()`.

**The shape is a real gate shape** — "what drift did *this* entry introduce"
is an agreement claim measured against the base, not against a fixture
(`.claude/rules/engineering.md`, *A seam gate reads what the real writer
wrote*). What forks is whether the engine carries it.

Options:

- **A checkout-at-sha helper on the API**, with engine-owned cleanup and
  engine-owned placement under the worktree base. Passes the
  second-implementation test — any chain wanting a differential gate wants
  exactly this. Against: one observed consumer, and
  `.claude/rules/engineering.md`, *An export earns its consumer*, asks for
  more than a survey before public surface grows.
- **Rule that gates own it**, with a `spec/worktrees.md` sentence saying so.
  Makes the `tmpdir()` block the sanctioned idiom, and invites four more
  copies of its swallowed cleanup.
- **Accept as debt.** Costs the next chain wanting a differential gate the
  same block, written fresh.

Parked because the first option is new public surface carrying a lifecycle
contract — who removes the tree, and what happens when the gate throws — that
no section of the corpus decides.

## The worktree base is reachable only as an env read at chain import (PARKED)

Drained from the inbox (2026-09-14, consumer-chain survey); verified on disk
this tick. `worktreesBase` (`src/paths.ts:346`) resolves
`FLUME_WORKTREES_DIR` else `<flumeDir>/worktrees`, and `:342-345` declares the
omission deliberate — "there is deliberately no `Chain.worktreesDir`, since a
committed chain file is the wrong home for it" — beside the measured vector
the override exists for: an agent whose `pwd` carries the root checkout's path
as a prefix can derive the root and write there.

**Two consumers carry the identical block** (`consumer-a.md` §3 #3,
`consumer-b.md` §3 #2): shell `git rev-parse --git-common-dir` at module scope
and export `FLUME_WORKTREES_DIR` before the factory runs, because the default
places a tick's cwd inside the checkout and env is the only knob. Verbatim
copying across consumers is the detector for a missing surface
(`.claude/rules/engine-boundary.md`, *Surface, not prescription*), and that
module-scope requirement is also why every surveyed chain resolves its roots
before the factory instead of reading `api.paths`.

**Amended (drained from `FLUMEAPI-REPORTS-THE-WORKTREE-REGISTRY`'s note): the
read end is shut too, and the shipped `.d.ts` points into it.**
`FlumePaths.flumeDir`'s doc comment (`src/flumeApi.ts:71-80`) tells a chain
that "`worktreesBase` (`src/paths.ts`) is the one resolution that says where a
worktree lands — resolve against it, never against this root", and
`src/index.ts` exports no such symbol; the package's `exports` map reaches it
under no spelling. That comment ships — `FlumeApi.paths` is public surface, so
it is hover text a chain author reads (`.claude/rules/engineering.md`,
*Narration is the ladder's bottom rung*, the `.d.ts` carve-out) — which makes
it a public directive naming an unreachable helper. In-repo `.flume/chain.ts`
imports the function from `../src/paths.ts` and declares the gap at the site
(`:789-793`: "a downstream chain would need it on `FlumeApi.paths`, filed the
day one asks"). Net: a chain that never sets `FLUME_WORKTREES_DIR` cannot
learn the base at all — the only chains that know where worktrees land are the
ones that chose the location themselves.

Same decision at the other end, not a sibling: under the first option the base
moves somewhere a chain still cannot name, under the second the chain supplies
it and needs no read, and only under the third does "expose it" become the
whole fix. Rule the two ends together.

Options:

- **Default outside the checkout** — a sibling of the git common dir rather
  than a child of `flumeDir`. Removes the path prefix for everyone, and with
  it the reason the block exists; costs the one-`rm` teardown promise, which
  holds today because the base tracks the relocatable state root.
- **Take a function, not a value.** `Chain.worktreesBase?: (paths) => string`
  — computed per host at load, never committed, which is the objection the
  site raises against `Chain.worktreesDir`. The chain still chooses; what it
  stops needing is an env var set before the engine's own module loads.
- **Keep, and document the module-scope idiom** in `docs/CHAIN-AUTHORING.md`,
  so the block is written once correctly rather than copied — and, on this
  option alone, export the base, since documenting an idiom leaves the `.d.ts`
  directing a chain at a symbol the package does not ship.

Parked because closing it overturns a decision the site declares deliberate,
which plan does not re-open on its own
(`.claude/rules/posture-sweep.md`, *Routing*).

## Nothing renders a prompt without spending an agent, and five consumers hand-built it (PARKED)

Drained from the inbox (2026-09-14, consumer-chain survey); verified on disk
this tick. The verb list in `spec/cli.md` *Subcommand surface* is `status`,
`tick`, `loop`, `wake`/`sleep`, `stop`, `job`, `log`, `check`, `friction`.
No `render` — removed in 0.10 with no replacement.

**The precedent is `check`,** whose whole rationale is stated in that section:
it "validates the working tree's `pending.json` **without spending an agent**",
read-only, invoking nothing. Prompt rendering is the other half of what a tick
is handed, and it has no such verb.

What ships today covers the *after*, not the *before*: `rendered-prompts/` plus
the verdict row's `promptPath` (`spec/prompt.md`, *The rendered prompt is
persisted before the agent runs*) answer "what was this tick told" once a tick
has run. Comparing renders across an upgrade needs the answer before.

**Field evidence.** One consumer pins the wording of the engine's rendered
`files` clause and throws at render if it changes (`consumer-c.md` §4) — the
only mechanism in five surveyed chains that turned an engine change into a loud
failure rather than a silent one, and 0.15.0's rewording fires it on every plan
tick. Two migration seats separately drove `loadChainModule` + `renderPrompt`
from scratch hosts to diff before/after renders. `renderPrompt` is exported;
`loadChainModule` is not, so the host is rebuilt each time — verbatim copying
across consumers is the detector for a missing surface
(`.claude/rules/engine-boundary.md`, *Surface, not prescription*).

Options:

- **A `render` verb, sibling of `check`.** Renders what the named phase (and
  `--entry`) would be handed, prints or writes it, invokes nothing. The
  rationale transfers verbatim from `check`'s own spec sentence. Costs a
  `spec/cli.md` *Subcommand surface* amendment, and a decision on whether an
  unresolved span exits `EX_DATAERR` like `check`'s refusal or renders the
  partial for inspection.
- **Export `loadChainModule` from the barrel.** Smaller; no verb, no spec
  amendment to the verb list. Leaves every consumer writing the same host, and
  hands out the dispatcher's load path as public API for one use-case.
- **Rule it covered and close.** A consumer wanting a render diff runs a tick
  in a scratch worktree — paying exactly the agent invocation `check` exists to
  avoid.

Recommend the first. Parked because it is new CLI surface, and `spec/cli.md` is
the human's.

## A test title can contradict its body, and the title is what a `pins[]` line buys (PARKED)

Drained from `BATON-LOUD-AGREEMENT-PINNED-AT-THE-DIR`'s note; every claim below
re-verified on disk this tick.

**The mechanics.** `judgeVitestReport` matches a `tests[]`/`pins[]` line with
`a.fullName.includes(line)` (`.flume/vitestJudge.ts:82`, and `judgeRedOnBase`
at `:160` the same way). vitest judges the body. Nothing reads the two against
each other. So the whole named-line mechanism — plan declares a property, build
titles a test with it verbatim, the gate proves a passing test carries that
title — rests on title↔body agreement that no rung holds. A title is the one
claim in the suite nothing checks, and a title is exactly what a `pins[]` line
buys.

**The instance.** Before `c3f7977`, `tests/Baton.test.ts` carried "awake() and
isAwake agree on the same unreadable dir: both throw" over a body asserting
`expect(() => baton.awake()).not.toThrow()` — its setup loops a flag *inside* a
readable dir, so only the stat fails. Green, and standing as the pin for a
loudness property it never exercised.

**How common, measured this tick.** Scanning all 919 `it(...)` titles under
`tests/` for a throw/refuse-shaped title over a `not.toThrow`-only body yields
two candidates, both false positives on read. One confirmed instance in the
tree — the class is real and rare.

**No mechanical rung is available, and that is a ruling rather than an
omission.** `bd75f27` deleted the hygiene suite because a suite reading prose
against code is harness governance wearing engine discipline; `engineering.md`,
*Narration is the ladder's bottom rung* now states it. Its one carve-out is
prose compiled into the package's public `.d.ts` — which is why
`tests/docComments.test.ts` survives, and why a test title, which the package
never ships, sits outside it. Any title-vs-body check would be exactly the
shape that was removed.

Four homes, none of them fileable — `.claude/rules/**` and `.flume/prompts/**`
are both outside every phase lane:

- **A standing sweep lens** (the note's proposal). `posture-sweep.md`,
  *A violation counts only when verified on disk this tick*, already carries
  judged lenses, and `tests/` is in the sweep domain, so a neighborhood whose
  frontier module is a test file has the file open already. Costs no
  machinery — but a lens that hits once in 919 titles is read every rotation.
- **A clause in `engineering.md`, *A green verdict is proven non-vacuous***
  (recommended). That section already governs "a test that passes over zero of
  its subject". A title naming a subject the body never exercises in the
  asserted direction is the same failure with `n > 0`: the pin fired, the
  subject was wrong. One sentence, no new per-rotation read, and it makes the
  shape citable in a `per` the moment a sweep or a build tick sees one.
- **A sentence in `prompts/build.md`** at the actor that writes the body. Line
  29 already tells build a line is matched on full name; it does not say the
  body must assert the title in the stated direction. Cheapest of the three,
  and it reaches the only agent in a position to prevent the mismatch rather
  than find it later. Weakest too: a prompt paragraph is the ladder's bottom
  rung, which is where this already lives.
- **Accept it.** One instance in the tree, caught by a build agent reading
  closely. Costs the next mislabelled pin, which reads as covering a property
  it never touched — and a pin is the artifact plan trusts when deciding a
  property is already held.

**Recommend** the `engineering.md` clause, with the `prompts/build.md` sentence
alongside it if a second rung is wanted: the two say one thing at the two
surfaces, and neither is paid per rotation. Held here rather than filed because
both files are human-held.

## Two `entryTag` spellings the amendment leaves, one of them unshippable (PARKED)

Derived from `1ebf971`; both legs verified on disk this tick.

**Leg A — `WorktreeSetupContext.entryTag` → `worktreeKey` is ratified but
outside every phase lane.** `spec/worktrees.md`, *`setupWorktree` and
`teardownWorktree` — the chain's provisioning hooks* now names `worktreeKey`;
`src/Phase.ts` still spells it `entryTag`, with call sites in `src/worktrees.ts`,
`src/Dispatcher.ts` (both concurrencies), a cross-reference in `src/Agent.ts`,
four `tests/` files and `docs/CHAIN-AUTHORING.md` — all inside build's fence.
The blocker is `.flume/chain.ts`: it imports `WorktreeSetupContext`, types
`setupBuildWorktree` by it, and constructs one as a literal with `entryTag:` for
the red-on-base gate. `.flume/chain.ts` is in `tsconfig.json`'s `include` and
outside every phase lane, so a build tick's `tsc` gate reverts the rename however
complete the rest of it is — the entry would cost a wave to discover that, which
is why it is here and not in the queue.

No fork on the rename itself. What is needed is one interactive commit spanning
`src/`, `tests/`, `docs/` and the chain (CLAUDE.md, *Source of truth*: breaking
runtime changes update chain.ts in the same commit) — or a `chore(flume):`
landing the chain side first, after which the rest files as an ordinary entry.

**Leg B — the usage row's identity field, where the spec and the type now
disagree.** `spec/loop.md`, *The tick verdict — one facts artifact* changed "the
entry `tag`" to "the entry's `entryTag`". The row's field is
`TickVerdictInvocation.tag`, and `TickVerdictMergeOutcome.tag` spells the same
fact the same way with a doc cross-reference between them. `1ebf971`'s body lists
`costUsd` and `worktreeKey` as the sentence-level contract changes and does not
name this one, so derive shipped only `costUsd` from that sentence.

- **Ratified rename, both arrays.** `tag` → `entryTag` on the invocation row and
  the merge-outcome row together, so the verdict artifact keeps one spelling. A
  breaking change to the verdict JSON every consumer reads.
- **The invocation row alone**, matching the sentence literally — leaves the two
  verdict arrays disagreeing about one fact's name.
- **Prose, following leg A vacating the name** — the sentence restores `tag`.

Recommend the third, or the first if the alignment with `AgentInvocation.entryTag`
is the point; the second buys the inconsistency the cross-reference exists to
prevent. Parked because all three answers are a human's spec or public-API call.

## The mined draft's empty-bucket shape is convention, not spec (NEEDS AMENDMENT)

Drained from `CHANGELOG-DRAFT-UNCATEGORIZED-SUBHEADING`'s note; verified on
disk. `spec/cli.md`, *Versioning policy* states the draft "closes `###
Breaking` with a `### Uncategorized` subheading over every non-breaking entry"
and is silent on what either heading does when its bucket is empty. The entry
shipped the renderer's standing convention — a heading renders iff its bucket
is non-empty — and `tests/build-changelog.test.ts` now pins both directions:
an all-breaking draft renders no `### Uncategorized`, a no-breaking draft
renders `### Uncategorized` alone with no `### Breaking`.

So the shape moved from prose-silence to two pinned cases without ever being
ratified. Either ruling needs a human: `spec/` is the human's alone, and an
entry against a sentence that does not exist carries no `per`.

- **Ratify the convention** (recommended). One sentence in *Versioning policy*:
  a subheading renders only over a non-empty bucket. It follows the section's
  own rationale — the second heading exists as "the curating human's cue for
  what is still unsorted", and an empty bucket has no cue to give. Zero code
  motion; the two pinned cases become the spec's.
- **Always emit both headings.** An empty `### Breaking` is an affirmative
  "the miner found none", where silence reads the same as a categorizer that
  never ran. Costs a spec sentence, a renderer change, and both pinned cases
  inverted.
- **Leave it unstated.** The tests hold the shape either way; the cost is that
  whoever next changes the renderer must notice that two test cases pin a
  convention nothing declares.

## Four dead absence guards in `.flume/chain.ts`, outside every phase lane (NEEDS AMENDMENT)

Drained from `GATECONTEXT-COMMITSHA-AND-BASESHA-REQUIRED`'s note; verified on
disk. `GateContext.commitSha` and `.baseSha` are both required now
(`src/Gate.ts:114`, `:140`), and the entry removed every absence guard in
`src/` and `examples/`. Four remain in `.flume/chain.ts`, which no phase can
write:

- `:269` `records gate requires commitSha`
- `:391` `per gate requires commitSha`
- `:787` `red-on-base needs baseSha and commitSha`
- `:273` `ctx.baseSha ? [ctx.baseSha, sha] : ["--root", sha]`, plus the
  `:256-262` paragraph naming the hand-built-fixture case that fallback
  existed for

All four are unconstructable: no cast escapes the type (no `as GateContext`
anywhere under `tests/` or `.flume/`), and both `tests/chain.test.ts` fixtures
supply a base (`:414` `EMPTY_TREE`, `:653` `${sha}^`), so the `--root` arm is
unexercised as well as unreachable. Dead plumbing and expired narration, the
two standing sweep lenses that name `.flume/chain.ts` as their domain
(`posture-sweep.md`, *A violation counts only when verified on disk this
tick*) — and the file sits outside `buildFence` and outside every plan slice's
lane, so no entry can reach it.

No fork on the fix: drop the three refusals, collapse the span to `[ctx.baseSha,
sha]`, and delete the fixture-fallback sentence. One `chore(flume):` from an
interactive session, or folded into the next chain-touching commit.

Not covered here, and correct as it stands: `TickResult.commitSha`/`baseSha`
(`src/Phase.ts:193`, `:228`) stay optional, because a no-commit tick has
neither. Only the gate surface changed.

## `spec/cli.md`'s **Bin.** bullet describes one bin, and `HARNESS-INIT-BIN` ships a second (NEEDS AMENDMENT)

Residue of the subpath-note question `4758d60` otherwise closed. That commit
enumerated the `exports` map and corrected both `dist/src/cli.js` spellings,
but *Distribution*'s **Bin.** bullet still describes `bin.flume` alone
(`spec/cli.md:317`), while `spec/harness.md`, *Adoption and upgrade* ratifies
`flume-harness` on the package's own bin and `HARNESS-INIT-BIN` ships it.

**Recommend** one additive sentence in that bullet: `bin.flume-harness` points
at `bin/flume-harness.js`, the same shim shape — argv through, stdio
inherited, exit code out, no options of its own. The `files` allowlist and the
both-directions packed-set check in the same section already cover it, so
nothing else in *Distribution* moves.

Actionable now rather than on a trigger — the spec already ratifies the second
bin; the bullet is the one place that has not caught up. Spec is the human's
lane (`.claude/rules/spec-plan-build.md`), and nothing in the queue blocks:
`HARNESS-INIT-BIN` ships the bin either way.

## A `promptArgs` value is prompt syntax, and two `spec/prompt.md` sections detonate the build render (PARKED)

Drained from a standing `render-refused` prior-attempt record keyed
`prompt-path-resolve` (headSha `e137674`): *prompt render aborted: 1
inline-exec span(s) failed to resolve — cmd: cmd — stderr: sh: 1: cmd: not
found*. Reproduced on disk this tick by running `INLINE_EXEC_RE`
(`src/Prompt.ts:43`) over the corpus.

**The mechanics, and the engine is behaving as specified.** `spec/prompt.md`
*The render pipeline* states the four stages are a pipeline, stage 2 scanning
stage 1's output: "an inline-exec span carried in by a `promptArgs` value is
executed… The engine neither delimits nor escapes what it substitutes."
`.flume/chain.ts`'s build `promptArgs` (`:885`) substitutes `PER_SECTION_TEXT`
— the entry's cited spec section, verbatim — and `PROMPT-PATH-RESOLVE` cited
`spec/prompt.md` *The render pipeline*, whose line 21 documents the span
grammar by writing one. The substituted section therefore carries a live span,
`cmd` is not a program, the render aborts, no agent is invoked, and the entry
walls identically on every retry. Deterministic, not flaky.

Exactly two sections in `spec/**` and `.claude/rules/**` carry span-shaped
text, both in `spec/prompt.md`: *The render pipeline* (`:21`, command text
`cmd`) and *Inline-exec spans reach `sh` through stdin, never argv* (`:191`,
where the code span around the bang opens a match that closes on the next
backtick, so the command text is a sentence fragment). So no entry may cite
either section while the chain substitutes section text — the queue cannot
express that constraint and nothing warns at derive time. `ENTRY_JSON` carries
the same exposure one layer up: `JSON.stringify` escapes quotes and
backslashes, not backticks, so a plan-authored `notes` field quoting the
grammar detonates every build tick on that entry.

**Unblocked, not fixed.** This tick re-cites `PROMPT-PATH-RESOLVE` at
`spec/chain.md` *Chain residency — one chain per `.flume`*, which states the
same rule ("it resolves against `configDir` — a relative path keeps its
meaning beneath it, an absolute one is taken as given"). That is a dodge with a
one-entry lifetime.

The fork is about a missing injection point, not a bug:

- **A declared data-substitution on the engine's side.** The chain names which
  `promptArgs` keys are data rather than syntax; the engine neutralizes spans
  in those values before stage 2. The chain supplies the value, the engine
  supplies the enforcement — a capability, not a convention
  (`.claude/rules/engine-boundary.md`, *Capability vs convention*). Costs a
  `spec/prompt.md` *The render pipeline* amendment; the pass-through stays the
  default, so the ratified "a span whose command contains a placeholder
  resolves" behavior is untouched.
- **Chain-side neutralization.** `.flume/chain.ts` defuses `PER_SECTION_TEXT`
  and `ENTRY_JSON` by hand. No spec edit, one line, inside build's fence.
  Every consumer chain that substitutes file content into a prompt writes the
  same block, which is the detector for a missing surface
  (`.claude/rules/engine-boundary.md`, *Surface, not prescription*).
- **Rule it the citer's problem and close.** Two landmined sections today; a
  derive tick avoids them. Leaves a trap nothing checks, re-armed by any future
  spec sentence that quotes the grammar.

Recommend the first. Parked because it amends a spec sentence whose rationale
is stated as measured, and because the second option is a one-line chain change
a human may simply prefer to the engine surface.

## Two spec sections say `promptPath` *joins* `configDir`, two say it *resolves* (NEEDS AMENDMENT)

Found while re-citing `PROMPT-PATH-RESOLVE` above; every line re-read on disk
this tick. The corpus disagrees with itself about the rule that entry ships:

- **resolves** — `spec/chain.md` *Chain residency — one chain per `.flume`*
  ("a relative path keeps its meaning beneath it, an absolute one is taken as
  given, which is how a package-shipped prompt gets an address"), and
  `spec/prompt.md` *The render pipeline* ("`phase.promptPath` resolved against
  `configDir`, a relative path beneath it and an absolute one as given").
- **joins** — `spec/cli.md` *Two independent roots* ("`phase.promptPath` joins
  it") and `spec/jobs.md`'s job-residency paragraph
  (`join(configDir, phase.promptPath)`, cited there to prove nothing resolves
  from inside a job dir).

`src/` joins today, so the two "joins" lines match the tree and the two
"resolves" lines are the ship target. `PROMPT-PATH-RESOLVE` flips the tree,
which leaves the "joins" pair stale rather than merely early. The answer looks
decided — *resolves* is what two sections state as intent and what the
harness package's absolute prompt addresses need — so this is an amendment,
not a fork: reword both lines to resolution. `spec/jobs.md`'s claim survives
the reword unchanged, because a job-dir prompt path is relative and still
resolves beneath `configDir`.

`spec/` is the human's; plan cannot make the edit. Naming it so the pair does
not sit contradicting the shipped tree unnoticed.
