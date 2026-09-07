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

## Debt note: `docs/CHAIN-AUTHORING.md` still documents `pendingGate`'s retired `pendingPath?` option

CHAIN-PENDINGPATH (this tick) removed `PendingGateOptions.pendingPath` — the queue path is now the one `Chain.pendingPath` value every reader resolves (`src/Gate.ts` `GateContext.pendingPath`), per `spec/pending.md` "The pending queue". `docs/CHAIN-AUTHORING.md:290` still lists `pendingGate({ targetFence, extension?, pendingPath?, fenceWhen? })`. Out of this entry's fence (docs/ wasn't in `entry.files`); pure narration drift, no behavior at stake — a one-line doc fix for the next tick that touches that file, not a pending entry on its own.

## FLUMEAPI-PATHS parked: fence-only — plan must widen `files.edit` by four `src/` files

**No human decision needed. This is plan's call, and only a plan tick can
make it.** Attempt 4 re-parked because trunk tip is still `266d80c` — the
attempt-3 park itself. Plan has not ticked since the park landed, so build was
re-dispatched against the same three-file fence and could only park again.
Re-dispatching build changes nothing; the entry needs a derive.

### The blocker, verified on disk this tick

`spec/chain.md`, *Per-run artifacts belong under `FLUME_DIR`*, makes
`buildFlumeApi` **require** `{repoRoot, configDir, flumeDir}` — that is the
whole mechanism ("once `buildFlumeApi` requires the roots, a verb cannot
construct the API without first resolving them"). The factory is applied
**inside** `loadChainModule` (`src/Dispatcher.ts:1064`,
`factory(buildFlumeApi())`), which is the single seam: the roots can reach it
only as a parameter on `loadChainModule` / `diskChainLoader`. Nine call sites
carry it; five are outside this entry's fence:

- `src/cli.ts:126` (`chainRefusesPhase`, wake/sleep), `:345` (`status`),
  `:478` (`check`), `:566` (`friction`), `:652` (`tick`/`loop`'s
  `resolveChain`)
- `src/cliJobVerbs.ts:42` (`job status`)
- `src/job.ts:176` (`jobNew`), `:279` (`jobRun`'s entry-phase wake)
- `src/builtinGates.ts:260` (`chainLoadGate`)

Required breaks all five at compile time, so `tsc` reverts. Optional invents
roots when absent — attempt 1 (`36907e3`, reverted) shipped
`paths ?? { repoRoot: dirname(path), … }`, handing `chainLoadGate` and the job
verbs a `repoRoot` of `.flume/` and a `flumeDir` that ignores `--job`: a
substituted placeholder with nothing refusing on it (`engineering.md`, *Loud or
nothing*), re-opening the very re-derivation the spec section closes. There is
no third shape.

### All nine sites are mechanical — no design fork

An earlier park claimed three sites needed a human ruling on what `flumeDir`
means for a verb that is not running a tick (`jobNew` has no `flumeDir`,
`job status` has no single one, `jobRun` has no `repoRoot`). Those claims are
true of the *option-object signatures* and false of the *call sites*: every
caller already holds the resolved value.

- `main()` resolves `repoRoot` at `src/cli.ts:135` and
  `{flumeDir, configDir, job}` from `resolveStateDirs` at `:240` — **before**
  it dispatches the job verbs at `:253`. No chain-loading verb reaches its load
  with roots unresolved (`e814195` closed that half of the spec's drift note).
- `jobNew` ← `src/cliJobVerbs.ts:116` and `job status` ← `:42`, both inside
  `runJobVerb(args, repoRoot, configDir)`: give it a fourth `flumeDir`
  parameter from `cli.ts:253`, pass it into `JobNewOptions`.
- `jobRun` ← `src/cli.ts:275`, inside `main()`, which holds `repoRoot` from
  `:135`. Add `repoRoot` to `JobRunOptions`.
- `chainLoadGate` ← `src/builtinGates.ts:260` — `ctx.repoRoot`,
  `ctx.configDir`, `ctx.flumeDir` are all on `GateContext` (`src/Gate.ts:94`,
  `:79`, `:53`).

No root is fabricated. `flume job new` / `job status` pass no `--job`, so
`resolveStateDirs` yields `<repoRoot>/.flume` — the honest root, because the
chain being loaded *is* the repo chain (`spec/chain.md`, *Chain residency*).
So `FlumeApiPaths` keeps all three members **required**.

### What plan does next tick

Widen `files.edit` to add `src/cli.ts`, `src/cliJobVerbs.ts`, `src/job.ts`,
`src/builtinGates.ts`. `tests/chain.test.ts` and
`tests/examples.integration.test.ts` also call `buildFlumeApi()` bare, but
build's `tests/**` channel already covers them. A `blockedBy` split buys
nothing — the threading is one argument per site and is not separately
testable.

For whoever writes it, to declare at the site rather than treat as a blocker:
under `afterCommit`, `chainLoadGate`'s `ctx.repoRoot` is the ephemeral worktree
while `ctx.flumeDir` is the primary checkout's state root (`spec/chain.md`,
*What a gate receives*). Handing a chain-under-validation those two is right —
the gate is not running a tick — but it should read as deliberate.

### Attempt 1's revert cause is unidentified — do not derive from the record

`.flume/prior-attempts/flumeapi-paths.json` opens with
`[truncated 16751 chars]…` and vitest's failure detail sits in the truncated
head; 4 tests across 2 files failed and neither name survives. The diagnosis
this file previously carried (a `hermeticEnv` / `FLUME_QUARANTINED_SLUGS`
collision) is **wrong**: `91694b8` made `hermeticEnv()` strip by prefix and is
an ancestor of `36907e3`, so that trigger could not fire. The surviving tail
shows heavy host contention (`transform 37.21s / collect 106.51s` against
`6.58s / 14.26s` quiet, ~7×) — load-coupled flake is the best available
reading, but it is a reading, not a finding. Treat the shape defect above as
the reason to change approach; treat the recorded cause as unknown.
