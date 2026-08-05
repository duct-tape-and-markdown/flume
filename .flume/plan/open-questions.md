# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `flume check` — validate pending.json without spending an agent

Status: PARKED

Inbox proposal (2026-08-05, human): operator edits to `pending.json` get no validation until
the next tick pays an agent to find out, though the pieces are pure (`parsePending`,
`touchedPaths`, `isPickableNow`, `matchesAny`) and no such verb exists (`src/cli.ts:280`).

The fork is real: a narrow verb running only the engine's own mechanics (pending parse + fence
arithmetic) is cheap and ships now. A chain-declared check surface (a `Gate` placement beyond
`afterCommit`/`afterMerge`) is a real capability addition — a schema change that needs the
second-implementation test (`engine-boundary.md`) run against it, not something plan should
default into. Recommend starting narrow; it composes forward with a chain-declared surface
later without foreclosing it. Your call on scope.

## Friction read verbs (`flume friction` list/cat)

Status: PARKED

Inbox proposal (2026-08-05, human): friction notes are per-machine and gitignored — the harder
to read, the faster they evaporate — but there's no read verb beyond the count `status` already
prints.

Boundary conflict, in the proposal's own words: `spec/chain.md`'s *`Chain.friction` — the
declared friction channel* states the engine "guarantees the channel's lifecycle without ever
reading its content." Listing filenames stays lifecycle-side; a `cat` verb crosses the sentence
as written. Either the sentence is amended to "without ever *interpreting* its content"
alongside a `cat` verb, or the feature stops at `list`. This is a spec-boundary call, not an
engineering one — human call, per the proposal itself. (A `list`-only verb could ship without
this decision if you'd rather not block on it; flag if you want that filed separately.)

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

## Verdict read-side in the CLI (`flume log`-shaped verb)

Status: PARTIALLY ADDRESSED

Inbox proposal (2026-08-05, human): tick history is renderer scrollback plus a terse `status`;
`readTickVerdicts` is exported (`src/index.ts`) and has zero references in `src/cli.ts`. A read
verb would close the gap.

Resolved this tick: the engine-boundary fork. `TickVerdict` (`src/Dispatcher.ts:201-260`)
carries only engine facts — `phaseName`, `tags`, `committed`, `gateResults`, `shippedTags`,
`mergeOutcomes`, etc. — with a doc comment explicitly excluding "park"/"bail worth waking for"
as chain vocabulary the engine doesn't own. A read verb can print these fields verbatim with no
reclassification risk (`engine-boundary.md`, *Told, not inferred*); it's safe to build as soon
as shaped.

Still open, and genuinely a naming/API-surface call rather than an engineering one
(`collaboration.md`, *Be especially loud about... naming choices*): (a) verb name — the
proposal suggests `flume log -n 5`; (b) output shape — human table (matching `status`'s
fixed-format precedent) vs. JSONL passthrough vs. both behind a flag. Once named and shaped
this is a small, well-scoped pending entry.

## Stale "Until `Phase.scopeWritesToEntry` ships" note in `.flume/prompts/plan.md`

Status: NEEDS AMENDMENT

This tick's own rendered plan prompt still carries: "Until `Phase.scopeWritesToEntry` ships,
the write guard still narrows to declared files on a scoped tick, so an under-declared path
also reverts the commit." `scopeWritesToEntry` has shipped and is tested — it's live at
`src/Dispatcher.ts:2342-2347`, and `spec/pending.md`'s *The entry-scoped write guard is opt-in,
and off by default* already describes it in present tense, not as a future ship target.

`.flume/prompts/**` sits outside every phase's `writablePaths` (`.flume/chain.ts`, ~L205
comment), so no autonomous plan or build tick can fix its own prompt — this needs a human edit.
Recommend simply dropping the "Until ... ships" qualifier: the sentence's substance (accuracy
satisfies both over- and under-declaration) holds regardless of `scopeWritesToEntry`'s
declaration state, so the caveat can likely be cut rather than reworded.

## Build tick double-wrote into trunk's `open-questions.md` — traced to agent behavior, not engine plumbing

Status: NEEDS AMENDMENT

Inbox 2026-08-05 incident: a worktree build tick wrote its park note to both its worktree's copy
of `.flume/plan/open-questions.md` (committed) and the trunk checkout's copy (left uncommitted),
dirtying trunk and refusing the dispatcher's cherry-pick — correctly, but the loop then spun
(~$0.75/tick across 7 ticks).

Investigated every engine seam this tick: `Dispatcher.runFanoutEntry` sets `ctx.cwd = wt.path`
and passes it unchanged through `renderPrompt`/`invokeAgent` (`src/Dispatcher.ts:2106-2149`) to
`Agent.ts`'s `claudeCode()`, which spawns the real `claude` binary with that `cwd`
(`src/Agent.ts:143-149`) — so the agent's own env-context "working directory" line is correctly
worktree-scoped for a fanout tick, not stale or hardcoded. `.flume/prompts/build.md` and
`.flume/chain.ts`'s `PARK_FILE` both reference `.flume/plan/open-questions.md` as a bare relative
string; `{{FLUME_DIR}}` (the one absolute-path template `renderPrompt` carries, trunk-anchored)
is unused in `build.md`'s park instruction. Every checked seam is clean.

Most likely remaining explanation: the agent itself constructed an absolute trunk path
mid-session (e.g. from `git worktree list --porcelain`'s output, which lists every worktree's
absolute path including trunk's) and used that literal path for a second `Edit` — agent
behavior, not an engine defect.

Recommend: add one line to `.flume/prompts/build.md`'s park instruction — never construct or use
an absolute path for the park file (or any channel path); always use the bare relative path
`.flume/plan/open-questions.md`. `.flume/prompts/**` sits outside every phase's `writablePaths`,
so this needs a human edit; no autonomous tick can apply it.

## Merge-stage failure backstop — provisioning's consecutive-identical-signature abort doesn't cover cherry-pick failures

Status: PARKED

Inbox 2026-08-05 incident (second seam, same incident): the same cherry-pick failure repeated
every loop iteration with no brake, burning a full agent invocation per lap.
`spec/loop.md`'s *Provisioning failures — quarantine, then abort* scopes the
consecutive-identical-signature backstop (`supervisorPolicy.abortThreshold`, default 3) strictly
to pre-tick `ProvisionFailure`s — `src/Dispatcher.ts:3195-3306`'s accounting is keyed off
`provisionFailures`/`ProvisionFailure.signature` alone. A cherry-pick conflict at merge time
produces no `ProvisionFailure` and isn't tracked by this streak at all.

This is an architecture fork, not a decidable derivation: does the abort-backstop mechanism
generalize to a failure-signature class spanning both provisioning and merge-stage failures (one
accounting path, one `abortThreshold`), or does merge-stage get its own separate scheme?
Recommend the former — one mechanism, one policy knob, keyed by failure-class-tagged signature —
but this reshapes `spec/loop.md`'s scoping and `Dispatcher.ts`'s `superviseLoop` accounting, so
it needs sign-off before it's derivable into a pending entry.
