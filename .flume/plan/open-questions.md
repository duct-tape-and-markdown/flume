# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## pendingGate — report both violation classes in one pass (inbox finding 3)

**PARKED**

`pendingGate` (`src/builtinGates.ts`, v0.8 §6) calls `parsePending`
(`src/PendingSchema.ts`), which is all-or-nothing over the whole entry
array (`z.array(...).safeParse`)
— a single entry's schema violation (e.g. an undeclared field) fails the
entire parse with no `entries` to fence-check, so a sibling entry's fence
violation only surfaces after the schema issue is fixed, costing a second
correction round (carto, observed). `parsePendingLoose` already exists as a
lenient sibling but is documented read-path-only (status-class commands)
and is itself still all-or-nothing at the array level — it doesn't solve
this.

Options:

1. **Partial per-entry parse mode** (some entries ok, some errored, in one
   pass) — changes `parsePending`'s return contract, a real semantics
   change beyond `pendingGate` itself.
2. **Keep fail-fast, improve the message** to note that fence violations
   may exist among the unparsed entries and will surface next round —
   cheap, no semantics change, doesn't actually collect both classes.
3. **Leave as-is.** Two-round correction is a UX cost, not a correctness
   defect — no entry ever ships without both checks eventually passing.

Recommended: lean (3) unless the two-round cost proves expensive in
practice — (1) is disproportionate machinery for a UX papercut, (2) barely
helps. Every real fix here is heavier than the problem it solves
(collaboration.md's complexity signal).

## setupWorktree install-options surface (inbox finding 4, narrowed)

**PARKED**

`setupWorktree(dir)` (`src/setupWorktree.ts`) takes no options — install
commands are hardcoded arrays; v0.7 §11's acceptance/non-goals text locks
the exact `pnpm install --frozen-lockfile` / `npm ci` shape with no options
surface.

The gate half of this question shipped: `BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE`
(86789b8/48a87df, cites `engine-boundary.md`'s *Capability vs convention*)
gives `tscGate`/`vitestGate`/`eslintGate` an optional `cmd` override the
chain supplies directly. A prior tick's audit found the override only closes
the gap for pnpm/yarn-classic-shaped tools — args stay hardcoded to the
bare-bin invocation, so `{cmd:"npm"}` fails npm's own "Unknown command" for
tsc/lint; filed `BUILTINGATES-CMD-OVERRIDE-PNPM-SHAPED-ARGS` to close that.
What remains open here is `setupWorktree`'s own missing options surface (no
`{ args?, env? }` of any kind today) — that one still needs a human call on
whether it's spec-worthy.

Options:

1. **Spec amendment.** Extend §11 with an optional `{ args?, env? }` on
   `setupWorktree` — becomes a normal derive-from-spec entry once written.
2. **Decline, chain-side workaround.** A chain wanting `--no-audit
   --no-fund` or `CI=true` can already wrap `setupWorktree` itself.

Recommended: (2) unless a real chain hits the need — the sharper duplication
smell (gates hardcoding `pnpm` with no override at all) is gone now that
the cmd override shipped; what's left is a wrap-it-yourself gap, not an
asymmetry.

## ENGINE-BRANCH-VERBS-VS-NAVIGATION-RULING

**RESOLVED and LANDED (operator, 2026-08-03) — state the condition.**

`spec/loop.md` now reads: *the engine never changes which ref HEAD points at,
and never creates or deletes a ref outside `flume/**`.*

The predicate first proposed with this ruling — "never touches a ref outside
`flume/**`" — was **wrong**, and the equilibrium audit caught it: the wave
touches the trunk ref three ways (`git.cherryPick`, `git.hardResetTo`,
`commitPendingUpdate` → `git.commitPaths`). The distinction is not which ref
but which operation. Advancing and resetting the tip you were handed is
recording; choosing a different tip is navigating.

Stated as a condition because the verb list drifted twice — first forbidding
`cherry-pick`, which the engine has always run, then `branch`, which it runs
over its own ephemeral names. A condition is evaluable by a sweep lens; an
exception list only accrues exceptions.

## win32 CI lane says "full suite", runs the fast lane (inbox 2026-08-02)

**RESOLVED (operator, 2026-08-03) — option 1: run the integration lane on win32.**

`pnpm test:integration` joins the windows job. win32 is the primary
development platform here and is the origin of the exact bug class the
integration lane covers — the `.cmd`-shim spawn defect and `execGate`'s
ENOENT shell-retry shim both came from it. A lane that documents the gap
(option 2) leaves the platform most likely to break the least covered.

CI-minutes cost accepted. If the lane proves flaky on the slower runner,
that is a follow-up about the lane's reliability, not a reason to reopen
this.

Pending: `spec/cli.md`'s win32 portability section states that the win32 lane
runs both suites, so the claim the comment makes becomes one the config has
to satisfy.

## `plan/pending.json` path: one fact, two homes (inbox 2026-08-02)

**RESOLVED (operator, 2026-08-03) — option 1: drop the override.**

The `plan/pending.json` layout is convention, not capability. `pendingGate`'s
`opts.pendingPath` override is removed and all five sites
(`Dispatcher.ts`, `builtinGates.ts`, `cli.ts` x2, `job.ts`) resolve the path
through one shared constant.

The override's only observed effect has been the desync it enables — a chain
overriding it gets a gate reading one file while the dispatcher writes
another. And it could never have been honest: `cli.ts`'s status and job
commands read the pending count **without loading the chain**, by design, so
a chain-supplied path is structurally unreachable from the surface that needs
it most. That is the upstream flag `.claude/rules/collaboration.md`
(*Complexity is a signal*) exists to catch — the capability was added without
accounting for the chain-less reads.

Nothing in this repo or `examples/` overrides it, so removal costs nothing
today. If a second implementation ever genuinely needs a relocatable pending
path, it arrives with a design that reaches the chain-less readers too.

Pending: `spec/pending.md` states the path as fixed layout under `flumeDir`,
one constant, no override.


## SHIP-CLASSIFICATION-IS-THE-ENGINE-GUESSING

Ship detection diffs a merged commit against the entry's **declared** `files`:
zero overlap means not shipped. That makes `files` a contract, which is exactly
the coupling the writablePaths ruling removed everywhere else — the last place
an entry declaration is load-bearing rather than advisory.

The operator's read: asserting success from paths committed is an overstep, and
gates passing should mean shipped.

Why gates alone do not close it: gates check *tree health*, not *work done*. The
incident that produced this predicate was a build tick that wrote only a park
note to `open-questions.md`, committed, passed tsc and vitest, and cleared its
entry from the queue with nothing built. Gates-only reproduces that exactly.

The real defect is that **parking is inferred rather than stated.** A no-commit
bail has an explicit mode (`voluntary-bail`); a park that *does* commit has no
signal, so the engine reverse-engineers intent from paths.

Options:

1. **Channel-only is not a ship.** Keep a path predicate but read it off
   `phase.entryChannelPaths` — a phase declaration — rather than `entry.files`.
   Closes the park case with no entry-level coupling. Fragile if channels are
   later removed, and a park written outside a channel escapes it.
2. **Explicit park signal.** Build states that it parked, the engine records the
   fact, the path predicate is deleted. Cleanest, and it matches "the engine
   reports facts, the chain interprets". Needs a channel that is not the commit
   message — parsing commit prose for meaning is the engine reading payload it
   should not.
3. **Chain-interpreted ship.** The engine reports (commit landed, gates passed,
   paths touched) and the chain decides. Most correct by the boundary rule, and
   new surface for one use case — weigh the complexity signal.

Recommended: (2), with (1) as the interim if a shape for the signal is not
obvious. The zero-declared-files bug is filed separately and does not wait on
this.

## CLAUDECODE-SKIP-PERMISSIONS-DEFAULT

`claudeCode()` passes `--dangerously-skip-permissions` by default. The rationale
in `src/Agent.ts` is that every Flume tick runs in a worktree the harness
controls — **false for singleton phases**, which run in the main checkout. This
repo's own plan phase is that case, so the default's justification does not
cover the phase it most affects.

An operator call, because it is a safety posture rather than a bug: the flag is
almost certainly wanted for autonomous operation, and the defect may be the
rationale rather than the default.

Options:

1. **Keep the default, fix the rationale.** An autonomous tick cannot answer a
   permission prompt, so a prompt is a hang; the fence and the gates are the
   real containment, not the worktree. Cheapest, and probably true.
2. **Default off, chains opt in.** Safest, and it breaks every existing chain on
   upgrade for a risk none has hit.
3. **On for fanout, off for singleton.** Matches the stated rationale exactly —
   and silently varies behavior per phase, the kind of implicit rule this repo
   keeps removing.

Recommended: (1). The containment claim should name the fence and the gates,
which are real, rather than the worktree, which is not always there.
