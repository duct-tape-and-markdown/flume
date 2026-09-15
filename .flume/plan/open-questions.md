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

## Rosters that read exhaustive and lag the shipped surface (PARKED — seven in spec, one in docs with no spec owner)

Eight sites, one shape; sites 1-7 verified on disk when filed, site 8 this tick.

1. **`spec/pending.md`, *What the package exports*** reads "`src/index.ts` and
   `FlumeApi` are the canonical lists. Both carry the *values*
   `composePendingList` … `slugify`, and `priorAttemptPath`." Both lists carry
   two values that sentence names in neither: `gitPath` and `stopFlagPath`
   (`src/index.ts:72`, `src/flumeApi.ts:151`). It reads exhaustive and is not.
   (`matchesAny` is correctly absent — it rides `FlumeApi` only, never
   `src/index.ts`, so "both carry" excludes it.)
2. **`spec/chain.md`, *The chain is a plugin, not a consumer*** names "the
   path-glob matcher `matchesAny`" as the engine rule a chain reaches for path
   policy rather than hand-rolling. The host-path-to-git-path rule is now
   reachable the same way, inside that sentence's scope, and goes unnamed.
3. **`spec/chain.md`, *What a hook receives*** enumerates the fanout `entries`
   record as `{ tag, committed, shipped, reverted, declined?, noCommit?,
   mergeOutcome? }`. `FanoutEntryOutcome.extension` — the entry's
   chain-declared payload, split by `CORE_ENTRY_FIELDS` (`src/Phase.ts:151`,
   `src/Dispatcher.ts:3128`) — shipped at `993c516` and is not on it.
4. **`spec/harness.md`, *The entry extension*** enumerates `summary`, `per`,
   `acceptance`, `tests[]`, `pins[]`, `notes` and says a consumer may add
   fields but not remove these. The package itself now declares a seventh,
   `contractTouching` (`harness/entryExtension.ts:84`), rendered last in the
   schema every plan slice reads. The list reads closed and is not.
5. **`docs/CHAIN-AUTHORING.md:88-90`, *Harness-managed state*** spells ten
   names "the runtime spells each of those itself". Nine are `RUNTIME_IGNORES`
   (`src/job.ts:62`); the tenth, `plan/pending.json`, is never ignored, and
   `node_modules/` — which is — is absent. Read as *which names the runtime
   spells, so you neither author nor move them*, it is a claim of its own and
   correct; read as the ignore set, it is a fourth copy. **This one is the
   fork**, not just the wording: the site is in build's fence, but if it is a
   copy it cannot shrink to a pointer, because no `spec/` section owns the
   ignore set it would point at. A spec-side home has to exist first.
   (`CHAIN-AUTHORING-IGNORES-POINT-AT-THE-SPEC` shipped the `job new` bullet
   45 lines below as a pointer into `spec/jobs.md` *Runtime ignores*, and left
   this one standing deliberately.)
6. **`spec/loop.md:519` and `spec/prompt.md:144`** each name one producer of
   `render-refused`: the record "every failing inline-exec span's command text
   and stderr", the mode "produced by this file's own refusal". A
   pre-invocation hook that throws is a second producer since `0f4b08b`
   (`src/Dispatcher.ts:4176-4197`, `src/priorAttempts.ts:543-558`), writing the
   same record with `<hook> hook threw:` text. **This one carries a fork too**,
   and reuse of the mode was forced rather than chosen: the taxonomy is ratified
   at four modes (*The no-commit taxonomy*), a thrown `shouldRun` is "a refused
   tick, not a decline" (`spec/chain.md`, *What a hook receives*), and no other
   class means "no agent was invoked and this was not a decline". So either the
   two sentences widen to name both producers, or the spec wants a fifth mode —
   which reopens `NO_COMMIT_MODES`, the precedence order at `spec/loop.md:494`,
   and every table keyed on it. Widening is cheaper; a fifth mode buys a typed
   distinction a chain today reads out of the record's `failures` prose.
7. **`spec/loop.md:521`** defines the `not-shipped` record as "the chain's
   `shipped` hook returned `false`". A throw out of `shipped` now writes the
   same record through the same builder (`src/Dispatcher.ts:3040`). No fork —
   one producer named where two exist. The *behavioral* half of that same
   change is its own question below.
8. **`spec/loop.md:561`, *The tick verdict*** enumerates the verdict's gate
   result row as "`TickVerdictGateResult`: the `gate` name, its `ok` verdict,
   its one-line `message`, its captured `details` … and its `skipped` reason",
   citing `spec/chain.md`, *What a gate returns*. Two lags, both landed by
   `e3882d0`: the type is `ReportedGateResult` (`src/Dispatcher.ts:218`,
   exported at `src/index.ts:103`), so the spelled name resolves nowhere in
   the package — a dangling referent, not a short list; and `verdict?` is
   absent from the enumeration, though the cited section documents it as
   "persisted verbatim onto the tick verdict's gate result". **This is the
   recommended option's cheapest case**: the sentence already carries the
   pointer, so the roster beside it is a second copy that can simply go
   (`.claude/rules/engineering.md`, *Derived state is computed, never restated
   beside its source*). The name has to move either way.

Beside them, one drift in `spec/harness.md` that is **not** an enumeration and
carries no fork — it rides the same edit pass. `spec/harness.md`, *The
default `handoff`*, says it "Reads the engine's reported pickable set and
no-commit facts." It also writes: `stopAfterContractTouchingShip`
(`harness/handoff.ts:190`) puts `<flumeDir>/stop` on disk after a shipped
entry marked contract-touching — the package's first disk write on the
handoff path, and live for this repo's own loop, which declares no override.
`spec/loop.md`, *One tick is one fresh process*, sanctions the mechanism, so
the drift is in this sentence alone.

Options; one ruling covers all eight:

- **Transcribe.** Name the missing values in each sentence. Cheapest, and
  leaves eight hand-maintained lists that go stale at the next export — which
  is how all eight of these got here.
- **State the property, not the roster** (recommended). Say what makes a value
  canonical — the two lists carry the same values, held by the `.d.ts`
  doc-comment scan the carve-out sanctions — and say what a hook record
  carries rather than which keys, so the next field needs no spec edit.
  `spec/cli.md`'s install-fixture sentence took exactly this shape at
  `d5c05b9`; the same move, two files over.
- **Accept.** These are the human's own surface and the ladder does not
  administer them. Costs the next omission.

Parked because `spec/` is the human's alone; build cannot reach it and plan
picking a wording would be plan authoring spec. Site 5 is parked for the
adjacent reason: build can reach `docs/`, but the ruling it needs is whether
`spec/` grows a home for the ignore set — and that is the same lane.

## Expired narration in three files no phase can write (PARKED — mechanical, human-only)

Drained from `AGENT-LOADS-ONLY-THE-CHAINS-MCP-CONFIG`,
`PLAN-DISCIPLINE-NAMES-THE-OVERLAP-RULE` and
`LANE-EXCLUDES-INFORM-THE-NAMED-LINE-HINTS`; all verified on disk this tick.
No fork here — it is parked only because neither plan's nor build's fence
reaches any of the three.

- **`.claude/rules/platform-facts.md:166-168`** closes *A headless `claude -p`
  inherits the user's MCP servers* with "Whether the engine passes it by
  default is an open engine question; until it does, a chain passes it in
  `extraArgs`." Both clauses fired at `66781ef`: `src/Agent.ts:216` passes
  `--strict-mcp-config` unless `ClaudeCodeOptions.inheritUserMcp` is set, and
  no chain passes it in `extraArgs` any more. The fact itself stands; the two
  closing sentences are what expired, and the sweep's expired-narration lens
  re-finds them every rotation until they go.
- **`.flume/PROTOCOL.md`** describes a plan layout that has since moved into
  the package. Line 70 names a cursor file `state.md` (it is `state.json`,
  three typed fields), a budget renderer `.flume/delta-window.mjs` (does not
  exist), "the predicates and the ladder" in `.flume/chain.ts` (20 lines
  applying the `harness/` factory), and "the shared writer discipline in
  `.flume/prompts/plan-discipline.md`" — that directory does not exist, so a
  slice following the pointer opens nothing and writes the queue without the
  discipline. Line 95 repeats `.flume/prompts/{...}.md`; line 3 puts "baton,
  gates, handoff, pending schema" in `.flume/chain.ts`.
- **`.flume/declaration.ts:62-64`**, the `runner:` block's comment, says the
  integration lane's exclusion means "a named line homed there is refused at
  plan time rather than reverted after a wave". No such refusal exists and
  none will: `LANE-EXCLUDES-INFORM-THE-NAMED-LINE-HINTS` is the decision that
  the exclusions **inform** authorship, since an entry's `files`/`tests` is a
  prediction build is not held to. That commit retired the package-side copies
  (`harness/runner.ts`, `harness/vitestRunner.ts`); this one it could not
  reach. The comment states a refusal the reader can go looking for.

Cheapest shape for the PROTOCOL pointers is the one a test already blesses:
name the page, not a path — `tests/harnessPrompts.test.ts:193` pins every plan
slice pointing at the discipline by the address `promptPath()` resolves, so
any spelled path beside it is a second copy that can drift.

## Does the harness declaration expose `inheritUserMcp`? (PARKED — a surface decision)

Drained from `AGENT-LOADS-ONLY-THE-CHAINS-MCP-CONFIG`'s note, which left the
call to plan; it is a declaration-surface decision, so it comes here.

`harness/declaration.ts:301` types `agents` per phase as `{ model?, extraArgs? }`
and `agentFactory` (`harness/chain.ts:513`) hands exactly those two to
`api.claudeCode`. The engine's opt-out has no declared spelling, and
`extraArgs` cannot reach it: `inheritUserMcp` *removes* `--strict-mcp-config`
from the argv, and nothing a consumer appends can unsay a flag. `agents` is the
declaration's only agent surface, so a consumer that needs its own MCP servers
inherited cannot ask — short of not using the package.

The sentence that moves either way is `spec/harness.md`, *What a consumer
declares*: the `agents` row reads "Model per phase and extra agent arguments."

- **Expose it** (recommended). A third optional field; the strict default is
  untouched, since it rests on a measured platform fact rather than taste. The
  `supervisor` row two lines down already states the principle — "declared
  here so one file holds the environment and no knob is lost behind the
  factory." The knobs the package does withhold are shape its own machinery
  depends on (`outputFormat: "stream-json"` for the terminal renderer, skipped
  permissions for autonomy); nothing in the package reads MCP inheritance.
- **Withhold.** The package ships flume's opinion by name, and inheriting
  by-user runtime state into a stateless tick is outside what it recommends at
  any setting. Costs such a consumer the package entirely, not just the knob.

## A `shipped` predicate that throws reads back as a deliberate park (NEEDS AMENDMENT — two spec sections rule differently)

Drained from `HOOK-THROWS-ANSWERED-LIKE-THEIR-SEAMS`'s note; verified on disk
this tick.

`spec/chain.md`, *What a hook receives*: "`shipped` throwing is not `false`:
the entry stays pending and the verdict names the throw, as it names a declined
ship." That shipped — `TickVerdictMergeOutcome.threw` (`src/Dispatcher.ts:360`)
is set only on a `not-shipped` a throw produced.

**Nothing in the engine reads it, and the one consumer that would is fenced by
the other section.** `superviseLoop` derives "errored" from an allowlist that
excludes `not-shipped` by name, "which are the agent and the chain correctly
declining" (`spec/loop.md:627-629`, *The tick verdict — one facts artifact*, *No
interpretation fields*; `src/loopSupervisor.ts:264-293`). A throw is not the
chain correctly declining, so the two collapse at exactly the seam the new field
exists to keep apart.

What that costs, traced on disk: a throw-produced `not-shipped` pushes no
`mergeFailure` (`src/Dispatcher.ts:3040-3049`, against the conflict leg at
`:2824`), so the tick is not errored *and* the quarantine leg has no signature to
key on (*Repeated identical failures*). The entry stays pending, the next tick
re-picks it, pays a full agent invocation, lands another commit that stays on
trunk unshipped, and throws again — to hibernation or the tick budget, with
`erroredTicks` empty and exit code 0. The sibling seam's identical defect class,
`promptArgs` throwing, is `render-refused` and *is* counted errored.

Fork: which sentence moves.

- **Narrow the exclusion** (recommended). `spec/loop.md:629`'s parenthetical
  excludes a `not-shipped` *the chain declined*; one carrying `threw` counts
  errored and its line names the throw. One clause, and the exclusion keeps
  reading as decided rather than overlooked — which is what the comment at
  `src/loopSupervisor.ts:271-279` already claims for it.
- **Leave it, and say so.** A hook throw is the chain's defect, the verdict
  records it, the operator reads `threw`. Costs a silent runaway for any chain
  whose predicate breaks — the shape `.claude/rules/engineering.md`, *Loud or
  nothing*, fences.
- **Quarantine instead.** Give the throw a merge-failure signature so the
  repeated-identical-failure leg drops the entry. Bounds the runaway without
  touching the exit-code allowlist, but files a chain-hook defect as a merge
  failure, which it is not.

Parked because both candidate homes are `spec/`, and because filing it as an
entry against `spec/chain.md` alone would send build at a line `spec/loop.md`
currently states. Once the sentence moves the work is one allowlist clause plus
its test in `tests/loopSupervisor.test.ts` — both inside build's fence.

## `FLUME_WORKTREES_DIR` outranks a chain's declared worktree base, and no spec sentence says so (NEEDS AMENDMENT — the order is unstated, not disputed)

Drained from `CHAIN-COMPUTES-ITS-WORKTREE-BASE`'s note; verified on disk this
tick.

`spec/worktrees.md`, *Placement — the worktree base and the job namespace*
states both branches and never their order: "The base directory is
`FLUME_WORKTREES_DIR` when set (resolved absolute), else `<flumeDir>/worktrees`"
and, separately, "A chain may declare how to compute one —
`Chain.worktreesBase?: (paths) => string`". With two of the three inputs live
at once, the spec rules nothing.

Build chose, and said so at the site: `worktreesBase` (`src/paths.ts:456`)
resolves env → declared → `<flumeDir>/worktrees`, reasoned in its doc comment
("An operator's env var still outranks it: the chain is committed, the host is
not") and pinned in `tests/paths.test.ts:422-445`. The reasoning is sound — a
chain's declaration is committed and travels to every host, an operator's env
var is that host's alone — but it is a precedence decision living one rung
below the spec that governs placement, where a chain author reading
`spec/worktrees.md` cannot find it.

Fork: which sentence lands.

- **Ratify the shipped order** (recommended). One clause in *Placement*: the
  override outranks a declared base, which outranks the default, because the
  env var is the operator's on a host whose committed `chain.ts` they may not
  own. Nothing moves in `src/`; the prose catches up to the code and the pins
  stop being the only statement of it.
- **Flip it — declared outranks env.** Reads a chain's declaration as the
  deliberate placement and the env var as the fallback. Costs an operator the
  escape hatch on a host running someone else's chain, which is the one
  measured vector *Placement* cites the override for. A one-line flip in
  `worktreesBase` plus two pins in `tests/paths.test.ts`.
- **Refuse the collision.** Both set and disagreeing is an error at chain load.
  Loudest, and no silent precedence to get wrong; costs the common case where an
  operator relocates a base on a host whose chain already declares one, which
  would then need the declaration edited rather than overridden.

## `runAtBase` is callable only inside a gate, and the escape hatch its refusal names is not exported (NEEDS AMENDMENT — the answer is clear, the sentence is spec's)

Drained from `RUN-AT-BASE-USES-THE-ENGINE-CHECKOUT`'s note; verified on disk
this tick. The note asked whether `spec/harness.md` should state that
`runAtBase` is a gate-time operation. Checking it turned up a second, sharper
half, and turned the note's own remedy around.

`checkoutAt` refuses when no `withGateCheckouts` scope is in flight
(`src/worktrees.ts:251-257`), so the shipped `vitestRunner.runAtBase` — and
`judgeNamedLines` above it — throw off the gate path. Both are public
(`harness/index.ts:19,25`). The note's stated workaround, "the caller opens
`withGateCheckouts` itself," is **not available**: that function is imported by
`src/Dispatcher.ts` alone and is on neither `exports` entry. Neither is the
escape hatch `checkoutAt`'s own doc comment names — "a caller that wants a
checkout it owns the lifetime of calls `addWorktree`/`removeWorktree`
(`src/git.ts`)" (`src/worktrees.ts:239-241`). Those two are on neither `FlumeApi.git`
(`src/flumeApi.ts:281-287`) nor `src/index.ts`, and the `exports` map reaches
no third module. That comment rides `FlumeApi.git.checkoutAt` into the shipped
`.d.ts`, so it is hover text a chain author reads — engine surface under
`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung* — and
it points at a route the package does not ship.

Runtime is unaffected: `namedLinesGate` is `afterMerge` and runs through
`Dispatcher.runGate`, which opens the scope.

Fork: is a public `judgeNamedLines` / `runAtBase` meant to be driven outside a
gate at all?

- **No — gate-time by design, and the spec says so** (recommended). Every
  declared consumer of `runAtBase` is the judge, and the judge runs from a
  gate. Exporting a scope opener or widening `api.git` for a caller that does
  not exist is public surface with no consumer (`.claude/rules/engineering.md`,
  *An export earns its consumer*). One clause in `spec/harness.md`, *The runner
  interface*: the `runAtBase` bullet already says the base checkout is the
  engine's; it adds that the checkout is reclaimed at the gate boundary, so the
  operation runs only inside a gate invocation. Once that line exists,
  `checkoutAt`'s doc comment trading its `addWorktree`/`removeWorktree`
  sentence for one naming what the package actually ships is an entry inside
  build's fence with a clean cite.
- **Yes — export a scope opener.** What a `flume judge <tag>` verb or a script
  drive would need. Costs a public surface whose contract is subtle — reclaim
  on both legs, async-local, overlapping gate invocations — and which has no
  caller today; the recommended branch can be reversed later, this one cannot
  be un-shipped.

## `afterMerge` runs the minutes-long judge before the seconds-long typecheck (NEEDS AMENDMENT — `spec/harness.md` rules the order and cannot be worked around)

Drained from the `CHECKOUT-AT-PLANTS-UNDER-THE-JOB-NAMESPACE` note; every
claim re-verified on disk this tick.

**The order.** `gatesFor` (harness/chain.ts:221) hands `harnessGates` the
package's own gates ahead of the consumer's declared list, and `harnessGates`
(harness/gates.ts) puts its four discipline gates first. At `afterMerge` only
two gates exist for build: `named lines` (harness/chain.ts:374, the whole
suite twice — merged tree, then base) and this repo's declared `tsc`
(`.flume/declaration.ts`). So the minutes-long judge runs first and the
seconds-long typecheck runs only if it passes. `spec/harness.md` *What a
consumer declares*, the `gates` row, states this outright: "the package's own
gates are always present and always first." No chain-side arrangement changes
it.

**What it cost.** A cross-entry signature drift — one entry changed
`withGateCheckouts`'s signature while its wave-mate landed a new caller —
typechecks clean in each worktree's own `afterCommit` tsc, because neither
worktree holds the other's commit. Only the merged tree sees it, and vitest
never typechecks. The drift therefore surfaced as an assertion failure in an
unrelated test file, the revert record named that file, and the merged tree's
tsc — which would have named the file and line in seconds — never ran.

**Forks:**

- **Ratify as written.** The order stands; a consumer wanting an earlier
  typecheck declares one at `afterCommit`. Does not help: the worktree cannot
  see its wave-mate's commit, which is the whole class of defect at issue.
- **Carve out ordering within a `when`.** The package's *discipline* gates
  stay first — they are what the sentence exists to protect, and all four are
  `afterCommit` anyway — while the package's *judge* trails the consumer's
  declared gates for the same `when`. Smallest amendment; the guarantee
  survives intact.
- **A declared placement knob** (`before`/`after` the package's own, per
  gate). More surface, and it asks a chain author to reason about an ordering
  the package understands better than they do.

Recommended: the second. One clause in the `gates` row distinguishing the
discipline gates (always first) from the judge (after the consumer's declared
gates at the same `when`), so cheapest-first is the shape rather than a
coincidence.

**Coupled to a queued entry.** `BUILTINGATES-NPM-EXEC-CASE-STOPS-TYPECHECKING-THE-REPO`
removes the one default-lane case that incidentally typechecks the whole
repo. That case is why the drift above produced *any* red inside the judge.
Once it is hermetic, nothing in the suite typechecks the merged tree, and the
declared `tsc` gate is the only reporter — which makes its position the only
thing deciding whether a cross-entry revert is legible. Correct either way;
the amendment decides how many minutes it costs to find out.
