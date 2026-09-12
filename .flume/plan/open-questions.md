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

**The sweep-lens half of this finding** — `docs/CLI.md`'s `flume job status`
paragraph asserting "no chain load" while the code takes one — closed with the
spec-writing ruling (`7367b79`): the sweep now reads `spec/` against
`.claude/rules/spec-writing.md` for restatement, and the generator the doc copy
was downstream of is gone. The amendment above is what remains.

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

## A test scans shipped doc-comment prose, on a rung the hygiene-suite ruling closed (PARKED)

Drained from `CORE-DOC-COMMENTS-CHAIN-VOCABULARY`'s note; verified on disk.
`tests/docComments.test.ts` (shipped `3c2cc24`) reads `src/Dispatcher.ts` and
`src/Phase.ts` as text and asserts two option doc comments match no
chain-vocabulary pattern. `bd75f27` — the day before, under explicit operator
direction — deleted the hygiene suite on exactly that ground: prose read
against code is harness governance, held by its authors, never promoted into
the suite (`.claude/rules/engineering.md`, *Narration is the ladder's bottom
rung*, last bullet). The scan is the same shape re-entering through a
different door, and plan derived it without noticing.

**The distinction that would save it.** The deleted suite read *harness* prose
— README, `docs/CHAIN-AUTHORING.md`, `spec/` — files the package never ships.
This scan reads prose that compiles into a shipped `.d.ts` and is the hover
text a consumer gets for a chain-facing option, which `engine-boundary.md`
(*Capability vs convention*) governs as engine surface. The bullet's own
exclusion list names "a rule page, PROTOCOL, a prompt, `spec/`" — a `.d.ts` is
on none of them.

**Against it.** The ladder's first paragraph lists "a doc comment" as prose,
the bottom rung; and "the ladder governs the engine's behavior, and stops
there". A doc comment narrates behavior, it is not behavior. On that read the
scan is the wrong rung and no rung is left — the note's own phrasing.

Two facts bound whichever way it goes. The scan is the sole instance: every
other file `tests/` reads is an agreement gate driving a real producer through
a real consumer (`tests/examples.test.ts:1045`), which *A seam gate reads what
the real writer wrote* sanctions outright. And "shipped hover text" is
narrower than `dist/`: `package.json`'s `exports` map is `./dist/index.d.ts`
alone, so the surface is what `src/index.ts` re-exports, not every `.d.ts`
under it.

Options:

- **Ratify the carve-out** (recommended). One clause on that bullet: prose
  reachable from the package's public `.d.ts` is engine surface and may be
  pinned; prose about the harness still may not. Keeps the scan and bounds the
  door — the deleted suite read files no `.d.ts` carries, so it does not
  re-open. One `chore(rules):`, human-only.
- **Retire the scan.** Delete `tests/docComments.test.ts`; the property returns
  to prose held by the same authors who hold the rest. The two doc comments
  stay fixed, and nothing catches the third. Files as an ordinary entry the
  moment it is ruled — `tests/` is inside build's fence.
- **Leave it unruled.** `tests/`'s suite files are still in the open
  rotation's frontier (state.md), so a later sweep tick reads this file against
  the ladder and raises the identical fork with no new information.

Parked because it is a governance ruling about the harness's own prose, which
`engineering.md` says this page does not administer — plan picking between
keeping and deleting a just-shipped test would be filling that gap silently.

## Two fence sentences name internal helpers, and build's extraction just aged both (NEEDS AMENDMENT)

Drained from `QUEUE-FENCE-PRECHECK-ONE-DERIVATION`'s note; verified on disk.
That entry shipped `queueFenceViolations` (`src/paths.ts`) as the one fence
pre-check, read by both `pendingGate` and `flume check`. Two spec sentences
describe the shape it replaced:

- `spec/pending.md`, *The entry-scoped write guard is opt-in, and off by
  default* — "The union has one home" names `entryWriteScopeUnion`'s consumers
  as `writablePathsGate` plus `effectiveFenceLines`. Both now reach it through
  `entryWriteScope`, and the queue pre-check is a third consumer the sentence
  does not mention.
- `spec/cli.md`, *The verbs* — `check` is "the same `entryWriteScopeUnion`/
  `matchesAny` computation the write guard enforces". True, but weaker than the
  tree: `check` and `pendingGate` now share one named derivation, so the verb
  and the gate cannot name different offending paths for one queue.

**Neither is false, and patching them is the wrong repair.**
`entryWriteScopeUnion`, `entryWriteScope`, `queueFenceViolations` and
`effectiveFenceLines` are all internal — none is on `src/index.ts`, and only
`matchesAny` (via `FlumeApi`), `writablePathsGate` and `pendingGate` are public
surface. So both sentences are already against `.claude/rules/spec-writing.md`,
*A claim names behavior, never location*: an internal helper, and the call order
between internal functions. Adding a third helper name deepens the violation,
and the next extraction ages the sentence again — which is exactly what just
happened, one commit after the first.

**Recommend** restating both as the behavior, naming no helper:

- pending.md — the fence the agent is shown, the fence the write guard
  enforces, and the fence a queue is pre-checked against are one computation,
  so they cannot differ. Keep the `matchesAny` semantics sentence; it names
  public surface.
- cli.md — `check` refuses on exactly the entries `pendingGate` would refuse,
  naming the same offending paths.

Two follow-ons the ruling decides, neither filed:

- `declaredPaths` appears in `spec/pending.md` five times, including as a
  defining equation (line 122). It is not exported either. Defining vocabulary
  the corpus then reuses is a fair read of why it is there — but if the ruling
  is that internal names go, it is the larger instance and should go in the
  same sweep (*A heading is an identifier* — no headings move here, so no cites
  re-home).
- With the pending.md sentence restated, `entryWriteScopeUnion` keeps no caller
  outside `src/paths.ts` but its own test. *An export earns its consumer* is
  satisfied by that test, so nothing is owed; if the human would rather it were
  module-private, that files as an ordinary entry — `src/` and `tests/` are both
  inside build's fence.
