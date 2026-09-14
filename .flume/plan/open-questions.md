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

## The `spec/jobs.md` ignore block names a retired file, `last-tick.json` (NEEDS AMENDMENT)

**`last-tick.json` no longer exists.** Drained from
`RUNTIME-IGNORES-NAMES-THE-TICK-ARTIFACTS`'s note. The block lists `last-tick.json`;
nothing in `src/` writes that name. The per-tick verdict file is `tick-verdict.json`
(`STATE_ROOT_NAMES.tickVerdict`), and `CHANGELOG.md:1357` records the rename.
`README.md` and `docs/CHAIN-AUTHORING.md` both already teach the new name. Build
shipped the accessor's name rather than the spec's — an ignore line for
`last-tick.json` would ignore a file no tick creates while leaving the real one
trackable, which is the defect that entry existed to close — so `RUNTIME_IGNORES` now
reads one line off the spec block verbatim. No agreement pin is driven off the block
today; the first one authored would fail against the runtime.

**Recommend:** `last-tick.json` → `tick-verdict.json`. `spec/` is human-only; it is not
a code change. This repo's own `.gitignore` carries the stale `.flume/last-tick.json`
line too — harmless (it ignores nothing), and inside build's fence, so it rides
whatever entry the amendment files.

**The first half closed, and its code half shipped.** The block was also missing
`merging/`; the amendment landed at `17cf6a3` and `RUNTIME-IGNORES-NAMES-MERGING`
shipped on 2026-09-11.

**A second fork that ship raised — pin the block, or shrink it to a pointer?**
Drained from that entry's note. The evidence this fork rested on is gone: the equality
pin on `docs/CHAIN-AUTHORING.md`'s copy of the same list left with the hygiene suite at
`bd75f27`, and that commit forecloses re-authoring it — prose read against code is
harness governance, held by its authors, never promoted into the suite
(`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*, last bullet).
So **pinning is off the table**, and the list now has three unpinned copies:
`spec/jobs.md:105-116`, `RUNTIME_IGNORES` (`src/job.ts`), and
`docs/CHAIN-AUTHORING.md:133-135`. The stale name above is what an unpinned copy does,
and nothing mechanical will catch the next one. The fork is now which copy stops existing:

- **Shrink the doc's copy to a pointer** at `spec/jobs.md`, *Runtime ignores*. Prose
  pointing at prose — no pipeline inversion, inside build's fence, files as an ordinary
  entry. Leaves spec and `RUNTIME_IGNORES` as the two copies the ruling hands to their
  authors.
- **Shrink the spec's copy to a pointer** at `RUNTIME_IGNORES`
  (`.claude/rules/engineering.md`, *Derived state is computed, never restated beside its
  source* — "in artifacts, the same bar"). Against it: the spec is upstream of the code
  here, so a spec section citing `src/` inverts the flow `spec-plan-build.md` rests on,
  and the section stops being readable standing alone.
- **Accept all three, author-held.** The ruling's own posture; costs the next stale name.

**Recommend the first** — it removes a copy at no cost to the pipeline's direction or the
section's readability, and leaves exactly the spec↔code pair the human already maintains.
Either way the name fix above lands first.

## The degraded chain load also rebases the pending count, and two spec sections say otherwise (NEEDS AMENDMENT)

Drained from `DOCS-CLI-CHAIN-LOAD-REPORTED`'s note (2026-09-11 build wave).
`loadChainForObservation` (`src/cliChainLoad.ts`) reports two costs of a failed
load, and the code takes both: the withheld friction/capability lines, **and**
the pending count falling back to the default queue path — `chain?.pendingPath`
threads into `resolvePendingPath` at `src/cli.ts:365` and into `jobStatus` at
`src/cliJobVerbs.ts:44`.

Two spec sections name only the first, and one of them denies the second
outright:

- `spec/cli.md`, *`flume status` owes exactly this* — item 5 states the count
  reads `<flumeDir>/plan/pending.json`, and item 6 then says "nothing above
  this line is withheld". For a chain declaring a non-default `pendingPath`,
  item 5 is false the moment the load fails: the degraded count reads a
  different file than the healthy one.
- `spec/jobs.md`, *`flume job status`* — "the entry count from
  `<jobdir>/plan/pending.json`", and the best-effort bullet stops at "withholds
  the friction counts".

**Not a code defect.** `resolvePendingPath` is the single resolver
(`src/paths.ts:155`) and both call sites already thread the declared path; both
sites carry a comment naming the fallback. `docs/CLI.md` now states it too —
the doc is ahead of the spec, which is the wrong direction for this pipeline.

**Recommend:** amend both sections to say the count resolves through
`Chain.pendingPath` when the chain loads and through the default relative path
when it does not, and soften item 6's "nothing above this line is withheld" to
exclude the queue path it does not cover. The alternative — ruling that a
degraded count must refuse rather than rebase (`engineering.md`, *Loud or
nothing*) — is a behavior change, and a plausible one: a `pending: N` read off
the wrong file is a confident wrong answer where `pending: unknown` would not
be. If that is the ruling, say so and this becomes an entry instead.

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

## The quarantine key excludes `observedFiles`, and `spec/loop.md` says "a hash of its bytes" (NEEDS AMENDMENT)

Drained from `QUARANTINE-KEYS-THE-ENTRY-AS-READ`'s note; verified on disk.
`spec/loop.md` *Repeated identical failures* keys the run-scoped quarantine by
"its slug and a hash of its bytes in `pending.json`". `quarantineKey`
(`src/Dispatcher.ts:768-801`) hashes the entry **minus `observedFiles`**, and
declares the divergence at the site.

The exclusion is load-bearing, not a shortcut. `commitPendingUpdate` merges a
failed attempt's footprint into `entry.observedFiles` (`src/Dispatcher.ts:4826`)
in the *same* wave that blames the entry, so a whole-bytes hash mints a fresh
key on the next read: every merge- and gate-stage quarantine lifts its own hold
one tick later and the run re-attempts the same wall at full agent price — the
burn the section exists to prevent. Provision-stage failures are unaffected (no
`mergeOutcome`, so no write-back). Every other write-back — `blockedBy` →
`open` — is a real state change and re-keys deliberately, which is the behavior
the sentence wants to keep.

**Recommend:** amend the bullet so the hash is stated over the entry *as
declared*, naming `observedFiles` as the engine's own accretion that is excluded
— the code's rule, said once in the spec, at which point the declared divergence
at `quarantineKey` shrinks to a pointer (`engineering.md`, *Narration is the
ladder's bottom rung*).

The alternative is a behavior change rather than a spec edit: rule that the key
must cover the whole entry, and move the `observedFiles` merge out of the
blaming wave so the accretion no longer re-keys. That is the larger change and
it buys nothing the exclusion does not already buy — but if it is the ruling,
say so and this becomes an entry against `commitPendingUpdate`.

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

## A `tests[]` line homed in the integration lane is invisible to the vitest gate (NEEDS AMENDMENT)

Drained from `CASCADE-SHOULDRUN-FROM-DISK`'s park (2026-09-11 build wave); verified
on disk. The build gate runs `vitest run --reporter=json` (`.flume/chain.ts:728`) —
the **fast** lane, and `vitest.config.ts` excludes `*.integration.test.ts` from it.
So a `tests[]` line whose only passing test lands in `tests/*.integration.test.ts`
is absent from the gate's report, and the entry reverts with "N of N named
behavior(s) have no passing test" no matter how green the work is. That is exactly
what cost this entry a wave: plan declared the decline case against
`tests/examples.integration.test.ts`, which the gate cannot see.

**Nothing warns at plan time, and nothing can.** `.flume/prompts/plan-discipline.md`
(*Tests ride the entry, and the gate reads them*) says "the file a test lands in is
build's call" — true, and the constraint the sentence omits is that the call is
bounded to the fast lane. The `pendingGate` cannot check it: the file does not exist
when plan derives.

**Recommend** one clause in that paragraph — a `tests[]` line names a behavior a
**fast-lane** test can carry; work whose only honest home is the integration lane
declares its named behavior over the fast-lane surface it exposes, or carries no
`tests[]` line at all. No fork, no mechanism, one `chore(flume):`. Parked only
because `.flume/prompts/**` is outside every phase lane.

**Reported independently from the field** (inbox, 2026-09-11, human), which
names the alternative and rejects it: the `vitest` gate could run the
integration lane whenever an entry touches `examples/` — a second full suite
per merge, paid on every such entry to buy a lane the fast one already
exposes. The prose clause above stays the right default.

I have re-homed every `CASCADE-*` entry onto `tests/examples.test.ts`
meanwhile, so the queue does not re-hit this wall while the wording is ruled.

## Two spec sentences still name unexported helpers, after the ruling that removed three (NEEDS AMENDMENT)

The two follow-ons `07b550c` left unruled, drained from the inbox and verified
on disk this tick. Both are the shape that ruling closed: a `spec/*.md`
sentence naming a symbol `src/index.ts` does not export, against
`.claude/rules/spec-writing.md`, *A claim names behavior, never location*.

- **`declaredPaths`** — `spec/pending.md` six times (:122, :240, :243, :254,
  :291, :406), including the defining equation and two equations built on top
  of it. Exported from `src/PendingSchema.ts`, absent from `src/index.ts`.
  This is the larger instance the ruling named: the corpus treats it as
  defining vocabulary, not as a location cite.
- **`runInlineExec`** — `spec/prompt.md` twice (:177, :220), in the same
  section whose third sentence `07b550c` restated. Module-private in
  `src/Prompt.ts`; nothing exports it.

Options:

- **Restate both as behavior** (recommended, and what the ruling implies).
  pending.md gives the equation a spec-owned left side — "an entry's declared
  paths" — so the corpus keeps its vocabulary without borrowing a symbol's
  spelling; prompt.md names the inline-exec span's own spawn in place of the
  helper. No headings move, so no `per` cite re-homes.
- **Carve out defining vocabulary.** Amend `spec-writing.md` to permit a name
  the corpus defines and then reuses, whatever its visibility; `runInlineExec`
  then goes and `declaredPaths` stays. Against it: the rule's bar is whether a
  reader needs `src/` open to follow the sentence, which a defined term
  already clears without the symbol's spelling.
- **Accept as debt.** Both age exactly as the ruled three did — the question
  re-opens on the next extraction that moves either.

Needs an amendment because closing it edits `spec/` (and on the second option
`.claude/rules/spec-writing.md`), which no autonomous phase may write.

## `spec/worktrees.md` still ratifies the blind delete `4d76998` shipped out (NEEDS AMENDMENT)

Re-filed from the inbox; the first filing was written at `2ef648c` and lost
to an unstaged edit (second question below is that defect). Verified on disk
this tick.

`createWorktree` (`src/worktrees.ts:183-199`) no longer removes whatever
occupies its computed path. It probes `git worktree list --porcelain`
(`readWorktreeRegistry`) and removes **only** a path git registers as a
worktree of this repo; an unregistered occupant, or a registry it could not
read, throws naming the path and provisions nothing. `spec/worktrees.md`
*Placement — the worktree base and the job namespace* still states the
retired behavior as deliberate, in three sentences:

- "`createWorktree` removes whatever sits at the computed
  `<base>/[<namespace>/]<dirName>` path if anything does" — now conditional
  on the registry.
- "The test is existence of the path alone: nothing checks that the directory
  is a git worktree, that it belongs to this repo, or that it carries a flume
  marker" — flatly inverted; that is exactly what is now checked.
- "An operator who points `FLUME_WORKTREES_DIR` at a directory holding
  anything else loses that content the first time an entry's bounded
  directory name matches" — no longer reachable; the tick refuses instead.

The `--force`-then-recursive-delete sentence stays true (`removeWorktree`,
`src/git.ts:274`), but it is now only ever reached for a registered path.

*Startup sweep* needs a smaller edit on the same commit. Its scope bullet
says "Every directory under the worktree base … removed", which was already
wider than the code and is now wider still — `sweepStaleWorktrees`
(`src/worktrees.ts:355-370`) skips every entry the registry does not name.
And its "Loud on failure, silent on empty" bullet does not cover the case the
same ship added: an unreadable registry removes nothing and **warns** saying
so, precisely so it cannot print the same silence a clean base does
(`src/worktrees.ts:344-353`).

**The carried fork, undecided.** *Placement* opens its removal paragraph with
"**The base must be flume-exclusive.**" That sentence was load-bearing when
existence was the whole test. Now the registry, not the base, bounds what gets
removed, and the sweep leaves a sibling's container directory untouched by the
same evidence. Two readings:

- **Exclusivity is retired.** It was a consequence of the blind delete, and
  the blind delete is gone. Say instead that the base may be shared, and that
  an occupant flume does not own is refused rather than removed. Against it:
  a shared base is still a collision surface for *names*, and the namespace
  argument two paragraphs down assumes sharing is possible anyway.
- **Exclusivity is still a requirement**, now merely no longer enforced by
  deletion — the operator is still asked not to point the base at their own
  content, because an occupant there stalls provisioning instead of being
  cleared. That is a real cost, just a loud one.

Recommend the second: the refusal converts data loss into a stalled entry, and
that is a weaker promise to the operator, not a retracted one. But the choice
is the spec's author's — plan restating either one would be picking it.

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

## `spec/jobs.md` § `flume job status` under-states two shipped readings (NEEDS AMENDMENT)

Drained from `JOB-EXISTSSYNC-NARROW-ENOENT`'s note; both sentences verified on
disk this tick. That entry (`ad2bb12`) narrowed `src/job.ts`'s existence gates
to `ENOENT`, and two sentences in this section still describe the pre-narrowing
readings.

**1. The per-job awake reading has a third value.** Line 173 states "the awake
phases from that job's baton, or `hibernating`". A job dir that exists but
cannot be read now reads as neither: `readAwake` (`src/job.ts:561`) returns
`null`, `JobStatus.awake` is `string[] | null` (`:471`), and
`src/cliJobVerbs.ts:60` prints `awake: unreadable`. It is per-job contained, so
one sealed job never hides its siblings. `docs/CLI.md:142` already teaches the
three readings. The section's very next bullet already spells the absent /
`unparsable` split for the pending count — same shape, same paragraph.

**2. An unreadable jobs root no longer prints `no jobs`.** Line 175 states "An
empty or missing jobs dir prints `no jobs`". `jobStatus` (`src/job.ts:600`)
returns `[]` on `ENOENT` alone and rethrows every other `readdir` failure, so
the verb fails rather than reporting an empty repo — an unreadable root hides
every job at once, which `no jobs` would state as a fact.
`docs/CLI.md:142` already spells "*missing*, never merely unreadable".

**Recommend widening both; no fork.** The code is the deliberate ship, each
reading is cited to `.claude/rules/engineering.md` *Loud or nothing* at its
site, and `docs/CLI.md` teaches both already — the spec is the only surface
still stating the old readings. Nothing is filable: `spec/` is the human's
alone, and there is no code change behind this.

Sibling, not an amendment, to the `last-tick.json` question above: same file,
different section, independent edits.

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

**Bound with *A test scans shipped doc-comment prose* above.** That question
asks whether a test may pin prose at all, and asserts `tests/docComments.test.ts`
is the sole instance of the shape. `tests/cliHelp.test.ts:157` is the
distinction that answers both: an expectation derived from a real run is an
agreement gate; a hand-authored one is the door `bd75f27` closed. Ruling that
line once disposes of both sections.

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
