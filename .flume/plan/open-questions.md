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

## Spec enumerations that read exhaustive and lag the shipped surface (PARKED — the human's file)

Three sites, one shape; all verified on disk this tick.

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

Options; one ruling covers all three:

- **Transcribe.** Name the missing values in each sentence. Cheapest, and
  leaves three hand-maintained lists that go stale at the next export — which
  is how all three of these got here.
- **State the property, not the roster** (recommended). Say what makes a value
  canonical — the two lists carry the same values, held by the `.d.ts`
  doc-comment scan the carve-out sanctions — and say what a hook record
  carries rather than which keys, so the next field needs no spec edit.
  `spec/cli.md`'s install-fixture sentence took exactly this shape at
  `d5c05b9`; the same move, two files over.
- **Accept.** These are the human's own surface and the ladder does not
  administer them. Costs the next omission.

Parked because `spec/` is the human's alone; build cannot reach it and plan
picking a wording would be plan authoring spec.

## `spec/cli.md` re-instates `flume render`, which an operator ruling deleted (PARKED — the fork is what replaces the three defects)

Derived from `spec/cli.md` *Subcommand surface* at `d5c05b9`: "`render` —
renders what a named phase (and, under fanout, `--entry <tag>`) would be
handed, and prints or writes it, invoking nothing: the other half of what
`check` does for the queue. An unresolved span exits `EX_DATAERR` naming it."

**Not derivable as filed**, because the verb was removed by name. `docs/
MIGRATING-0.10.md` §8 and `tests/cliHelp.test.ts` (CLI-RENDER-REMOVAL,
operator ruling 2026-08-03) record why: it "previewed with the wrong fence,
the wrong prior-attempt state, and its own re-derivation of pickability that
disagreed with the dispatcher's — three ways to show an operator a prompt the
next tick would not send." Three cases pin its absence from the subcommand
surface.

The new framing answers two of the three: "what a named phase would be
handed" means the dispatcher's own resolution, so the fence and pickability
are read rather than re-derived. The third has no answer in the sentence — a
render outside a tick has no attempt, so there is no prior-attempt block to
show, and the old verb's failure was showing one anyway.

Forks the bullet leaves open:

- **Prior-attempt state.** Render with the block omitted and say so in the
  output; render the block a retry *would* carry by reading the store; or
  refuse when the entry has a recorded attempt. Omitting it silently is the
  2026-08-03 defect returning under a new name.
- **"Prints or writes".** stdout only; `--out <path>`; or into the job's
  `rendered-prompts/` capture dir (`spec/jobs.md`). A CLI output destination
  is not plan's to choose.
- **Provisioning.** A real tick renders its fence after `createWorktree`/
  `setupWorktree`. Rendering without a worktree is cheap and is what an
  operator wants; whether the rendered fence is then the one the tick would
  send is the question the old verb got wrong.

Recommended: stdout only, no `--out`; the dispatcher's own resolution path
short of the invocation; the prior-attempt block omitted with a named line
saying it is, never reconstructed. `check` is the precedent for all three —
it reads the real parse and refuses rather than previewing an approximation.

Parked rather than filed because each fork is a CLI surface decision
(`.claude/rules/collaboration.md`, *Push back on weak product/UX specs*), and
because shipping the verb retires three tests that pin a standing ruling.

## Expired narration in two files no phase can write (PARKED — mechanical, human-only)

Drained from `AGENT-LOADS-ONLY-THE-CHAINS-MCP-CONFIG` and
`PLAN-DISCIPLINE-NAMES-THE-OVERLAP-RULE`; both verified on disk this tick. No
fork here — it is parked only because neither plan's nor build's fence reaches
either file.

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
