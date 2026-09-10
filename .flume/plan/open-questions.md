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

## 180 doc cites in `src/` point at a spec corpus that no longer exists (PARKED)

Posture sweep over the `src/Dispatcher.ts` neighborhood. Every `src/` module
carries `RELEASE-v0.N §M` / `v0.8 §5`-style cites into `spec/RELEASE-v*.md`
— files the corpus reform deleted from the tree. 180 sites across 16 modules,
verified this tick: `src/Dispatcher.ts` 81, `src/cli.ts` 18, `src/job.ts` 18,
`src/Prompt.ts` 12, then a long tail. Nothing in-file defines the section
numbers, so none resolves for a reader today. Scope is wider than `src/`:
`examples/cascade-chain.ts` carries `RELEASE-v0.11 §6` and `v0.8 §2` too,
so whichever option wins covers `examples/` as well.

Correctness-adjacent by one hop rather than directly: it is the audit
dimension's own machinery. A tick cross-checking a diff against the section
that governs it cannot follow the cite, so drift in that code is invisible to
the check meant to catch it.

Not filed — it needs a ruling on what these comments are *for*, and per-cite
retargeting is not mechanical:

- **A — retarget** each cite to the `spec/*.md` section that governs it now.
  Truest, and the only option that restores the audit path; also the most
  work, and some cites have no live successor section.
- **B — delete** the release cites, keeping only `spec/*.md` ones. Cheap and
  uniformly mechanical; loses the provenance trail (git still has it).
- **C — keep as historical provenance**, and say so once at the top of each
  file so a reader stops trying to follow them.

Whichever wins, the promotion is a source-shape pin: no cite matching
`RELEASE-v` / `v0.N §` outside a declared-historical marker — the rung
`tests/retired-narration.test.ts` already occupies.

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

The prompt is half of it: `examples/cascade-chain.ts`'s `spec` phase declares
the same `specs/active/**` / `specs/_aligned/**` / `workshop/_archive/**`
partition, and that file is the load-bearing example. Decide both together.
(Unrelated to PRE-0.10-CHAIN-SHAPE-TAUGHT, which touches only that file's
trailing host-repo instruction block.)

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

## `spec/chain.md`'s closing **Gap:** note is false on both halves (PARKED — spec housekeeping)

Residue of `62aa506`, which retired the five `Drift:` notes but left the
`Gap:` note under *The package a chain loads through* (`spec/chain.md:688`)
citing one of them.

Both halves verified false on disk this tick:

- "see the drift note above" has **no referent** — `grep "Drift:" spec/chain.md`
  returns zero after `62aa506`.
- "whose chain fixture is pre-factory" — `scripts/smoke-install.mjs:64-83`
  declares `const factory: ChainFactory = (api) => ...; export default
  factory`, packs the real tarball, installs it, and runs `status` through the
  generated shim. So the note's conclusion — "nothing currently proves a
  *published* package loads a factory-shaped chain end to end" — is what the
  smoke has proven since the fixture moved to the factory shape.

**Recommend:** delete the note. Same reasoning as `62aa506`'s own body — a
gap note plan's derive reads as live work is worse than none, and this one
would file an entry for coverage that already ships.

## A leaked `/tmp/.flume/stop` red-lines the default lane (observed, cause unattributed)

Seen twice this tick (2026-09-06) while running `pnpm test --run` in a fanout
worktree: a run left `/tmp/.flume/` behind holding `awake/` and an empty
`stop`. Every subsequent run then failed 8 tests across `tests/cli.test.ts`
(5) and `tests/cliJobResolution.test.ts` (3) — CLI fixtures under `tmpdir()`
walk up, find that state root, and see `stop present` / `awake: anything`
instead of `hibernating`. `rm -rf /tmp/.flume` makes all 8 pass unchanged; a
later full run did not recreate it, so the write is intermittent and I could
not attribute it to a specific test.

Correctness-adjacent: the same suite is the build phase's `afterMerge` gate,
so a leak reverts innocent entries for host state no entry touched. Two forks
— pin the CLI fixtures against ancestor discovery (an env override or a
sentinel-rooted temp base, so `tmpdir()`'s parents are unreachable), or find
and fix the writer. The first bounds the blast radius whatever the second
turns up.

## A prior-attempt record whose entry left the queue without shipping is never cleared (PARKED — spec silent, and the fix forks)

Drained from the inbox (2026-09-10, human via flume-main). Verified on disk
this tick at `a83836f`: `.flume/prior-attempts/` holds four records
(`buildpriorattempt-tail-bias-gate-revert-details`,
`pending-schema-core-extension-split`, `friction-nonenoent-swallowed`,
`test-hermeticenv-strips-tip-claim-held`); none of those tags is in
`pending.json`. `clearPriorAttempt` runs only on a clean ship
(`src/Dispatcher.ts:2123`, `:2797`), so a record whose entry plan retired,
re-scoped under a new tag, or judged already-landed stands forever. The
directory is engine-owned and outside every phase lane, so no autonomous tick
can clear it — the operator `rm`s the files meanwhile.

**Not derivable as filed.** `spec/loop.md` *Prior-outcome feedback to the
retrying tick* states the property ("No false signal") and exactly one
mechanism ("a clean ship clears the record"). It is silent on the non-ship
exit — silence, not contradiction — so the line moves before any entry can
cite it.

**One correction to the filed shape.** The note proposes clearing at
`commitPendingUpdate`'s rewrite, "which already knows which tags left the
queue". That rewrite runs only in the fanout wave; these tags left via a
**plan** commit, which the engine never diffs. Option A below therefore costs
a new post-singleton queue read, not a free byproduct.

**Keying obstacle for A and B.** `priorAttemptKey` is `slugify(entry.tag)` for
fanout and `phase.name` for singleton, with no discriminator on disk. "Key not
in the queue" cannot separate a retired tag from a live phase record without a
rule for that collision.

Options:

- **A — engine clears.** A tag-keyed record whose tag is absent from the queue
  after a plan commit is removed. Needs the discriminator above plus the new
  read.
- **B — engine reports.** `staleRecords` on the verdict / `TickContext`,
  clearing nothing. Facts-not-verdicts (`engine-boundary.md`), but the files
  still accumulate with no lane able to delete them.
- **C — no engine change.** The chain already holds both halves: `TickContext`
  carries `pending` *and* `priorAttempts`, and `api.priorAttemptPath` maps a
  tag to its on-disk key without reimplementing `slugify`, so `reconcileDue`
  can filter to records whose key is still in the queue. The routing rule
  (`engine-boundary.md`) prefers this — a chain could have decided it.

**Recommend C**, plus a `spec/loop.md` line naming what clears a record when an
entry leaves the queue unshipped, so the on-disk accumulation gets a stated
owner rather than standing as unattributed litter.

Rider for whoever takes C: `.flume/chain.ts`'s `anyVoluntaryBailRecord` (:46)
`readdirSync`s the prior-attempts directory itself, which the same spec section
says a chain never does ("the same read populates `TickContext.priorAttempts`
for `shouldRun` … so a chain never opens the directory itself") — `shouldRun`
already receives the map. That restatement and the staleness filter are one
edit. chain.ts is outside every phase lane, so it is a `chore(flume):` commit
from an interactive session, never a pending entry.

Filed separately, not blocked on this ruling: `PRIOR-ATTEMPT-ANCHOR-REFUSED` —
all four records also predate `headSha`/`at`, and `readPriorAttempt` validates
`mode` alone, so they enter the typed map un-anchored.

## `.flume/chain.ts`'s park detection now restates a fact the engine reports (adoption, not a question)

`NOT-SHIPPED-PRIOR-ATTEMPT` shipped: a `shipped: false` verdict now writes a
`not-shipped` prior-attempt record under the entry's key, so
`TickContext.priorAttempts` carries the park. `reconcileDue`
(`.flume/chain.ts:509-522`) still reads it off the verdict log via
`readLatestVerdictsSync(...)[BUILD].mergeOutcomes`, and its doc comment now
states something false — "writes no prior-attempt record and is visible only
on the verdict". Both halves are `engineering.md` *A fact the engine holds is
reported* residue against the chain, deleted in the adopting commit.

The adoption is one edit with the rider already parked above (the
`anyVoluntaryBailRecord` `readdirSync`): both legs of `reconcileDue` collapse
into one scan of the `priorAttempts` map `shouldRun` already receives — `mode
=== "voluntary-bail" || mode === "not-shipped"` — dropping the directory walk
and the verdict-log read together. `.flume/chain.ts` is outside every phase
lane, so it is a `chore(flume):` commit from an interactive session, never a
pending entry.

## A singleton's sweep failure is recorded nowhere (observation, from TICKRESULT-PROVISION-FAILURES)

`spec/loop.md` *Repeated identical failures* counts **sweep, create, or
`setupWorktree`** as the provision stage. `runFanout` records all three:
`pruneWorktrees` throwing pushes an untagged `ProvisionFailure`
(`src/Dispatcher.ts:2309`). `runSingleton` records create and `setupWorktree`
but only *logs* its `pruneWorktrees` throw (`:1820`) — if the create then
succeeds, the sweep wall reaches neither the verdict, nor the
consecutive-failure accounting, nor (now) `TickResult.provisionFailures`. A
deterministic prune wall on a singleton-only chain therefore repeats forever
with the backstop blind to it.

Out of this entry's declared files; not fixed here. Mechanical if filed: build
the record at the catch and carry it to both surfaces the way this entry's two
singleton returns now do.
