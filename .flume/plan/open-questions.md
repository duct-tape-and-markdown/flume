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

## `.flume/chain.ts` still carries three engine restatements (two adoptions and a fork)

Two legs of the 2026-09-10 finding are adopted (`dd258df`): `parkStanding` reads
`TickContext.priorAttempts` alone, and the prior-attempts `readdirSync` and the
verdict-log read are both gone. Three remain, and none is a pending entry —
`.flume/chain.ts` is outside every phase lane, so each is a `chore(flume):` from an
interactive session. The third carries a fork the other two do not.

**The park predicate, third copy.** `build.handoff`'s `refused` (`.flume/chain.ts:851-855`)
still reads a park as `committed && !shipped && !reverted` over `result.entries`. A
cherry-pick conflict satisfies that, so a conflicting wave wakes `plan-inbox`, whose
`parkStanding` counts only the records — no record is written for a conflict — and the
slice declines: one wasted tick, then the ladder retries from the new base. The site
names the bound in a comment meanwhile. `HANDOFF-ENTRY-MERGE-OUTCOME` is the engine
half: once `TickResult.entries` carries the per-entry merge outcome, the predicate and
its comment go in the adopting commit.

**The clean-exit rename is parked on the other.** `CLEAN-EXIT-TAXONOMY` renames
`voluntary-bail` to `clean-exit` in `NoCommitMode`; `.flume/chain.ts:852-854` compares
`result.noCommit` and `e.noCommit` against the literal `"voluntary-bail"`, a TS2367
error the moment the member leaves the union — and chain.ts is in `tsconfig.json`'s
`include`, so the build tick would revert on its own tsc gate. `REFUSAL_MODES` (:573) is
already forward-compatible; only the `===` arms are not. Deleting them unparks the entry,
and it is the same edit as the predicate above.

**The worktree base, hand-built — and the fork.** Drained from
`WORKTREE-BASE-DOCS-PINNED`'s note; verified on disk. `redOnBase`
(`.flume/chain.ts:726`) builds its scratch worktree at `join(api.paths.flumeDir,
"worktrees", …)`. Under `FLUME_WORKTREES_DIR` that is a base nothing else uses:
`sweepStaleWorktrees` looks under `worktreesBase` (`src/paths.ts:150`), so a gate that
crashes mid-run strands a worktree nothing reclaims. Latent here — the override is
unset — and correctness-adjacent the day it is not.

Two ways to close it, and the choice is the fork:

- **Chain-side, today.** The chain imports `worktreesBase` from `../src/paths.ts`. Free
  for this repo, which dogfoods the in-repo runtime, and unavailable to any downstream
  chain: `worktreesBase` is not in `src/index.ts`, so the package's export map hides it.
- **Engine surface.** `FlumeApi.paths` reports the resolved base. But `spec/chain.md`,
  *Per-run artifacts belong under `FLUME_DIR`*, states that surface as the closed list
  `{ repoRoot, configDir, flumeDir }`, so the spec line moves before the field can —
  human-only, and the reason this is a question rather than an entry.

**Recommend** the chain-side import now, and file the engine surface the day a second
chain needs it — the same disposition the `redOnBase` gate itself took. Either way
`FlumePaths.flumeDir`'s doc comment (`src/flumeApi.ts:73`) rides the adopting commit: it
names worktrees as living under the state root, which the override makes false.

Riding whichever commit lands first, by the 2026-09-11 ruling on `stateRootRel`: the
`perResolvesGate` read of `pending.json` at `ctx.commitSha` (`.flume/chain.ts:340-345`)
**stays**, and gains a one-line cite naming it the sanctioned queue-read idiom
(`spec/chain.md`, *What a gate receives*) so a later sweep does not re-file it as
restatement.

## The `spec/jobs.md` ignore block is missing a line and names a retired file (NEEDS AMENDMENT)

The 2026-09-11 rulings landed two lines that pull against each other. `spec/loop.md`
*Crash equals stop* introduces `<flumeDir>/merging/<slug>.json`, written and removed by
the dispatcher on every merge — runtime state directly under the state root.
`spec/jobs.md` *Runtime ignores* enumerates `RUNTIME_IGNORES` as a closed block, and
`merging/` is not in it. The ruling's own stated purpose is that "a fresh adopter never
commits a tick artifact because a line was missing", so the omission reads as an
oversight rather than a decision, but the block is explicit enough that filling it
silently would be plan choosing for the human.

Both entries are derived and independently shippable either way
(`MERGE-INTERRUPTED-MARKER`, `RUNTIME-IGNORES-NAMES-THE-TICK-ARTIFACTS`); only the line
is missing. `MERGE-INTERRUPTED-MARKER` is now re-declared **without** `src/job.ts` —
filling the block from the entry would be plan choosing for the human — so it carries
`merging/` in this repo's `.gitignore` alone, and an adopting repo leaves the marker
trackable until the amendment lands.

**Recommend:** add `merging/` to the `spec/jobs.md` block, at which point `RUNTIME_IGNORES`
gains it off `STATE_ROOT_NAMES` — one name, one accessor, no second spelling — as a
one-line entry the next derive files. The alternative — the marker lives somewhere already
ignored — would put crash-recovery state under `prior-attempts/`, whose lifecycle
(cleared on a clean ship) is the wrong one for a file only the operator may remove.

**Second defect in the same block — `last-tick.json` no longer exists.** Drained from
`RUNTIME-IGNORES-NAMES-THE-TICK-ARTIFACTS`'s note. The block lists `last-tick.json`;
nothing in `src/` writes that name. The per-tick verdict file is `tick-verdict.json`
(`STATE_ROOT_NAMES.tickVerdict`), and `CHANGELOG.md:1357` records the rename.
`README.md` and `docs/CHAIN-AUTHORING.md` both already teach the new name. Build
shipped the accessor's name rather than the spec's — an ignore line for
`last-tick.json` would ignore a file no tick creates while leaving the real one
trackable, which is the defect that entry existed to close — so `RUNTIME_IGNORES` now
reads one line off the spec block verbatim. No agreement pin is driven off the block
today; the first one authored would fail against the runtime.

**Recommend:** `last-tick.json` → `tick-verdict.json`, in the same edit as the
`merging/` line above. Both are `spec/` and so human-only; neither is a code change.

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

**Also, a proposed sweep lens.** The stronger half of the same finding was
`docs/CLI.md`'s `flume job status` paragraph asserting "no chain load" while
the code takes one — prose *denying* a load rather than merely omitting it.
`.claude/rules/posture-sweep.md`'s lens list (*A violation counts only when
verified on disk this tick*) has no lens that would have caught it. Worth one:
doc prose that denies a call the module makes. Human's file, so parked here
beside the spec amendment it arrived with.

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
