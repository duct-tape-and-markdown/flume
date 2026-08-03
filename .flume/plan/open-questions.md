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

The navigation doctrine (`spec/loop.md`, *The engine records, never
navigates*) states: "The engine never runs `checkout` or `branch`, and ships
no branch grammar." The engine does both. `git.addWorktree` runs
`worktree add -B <branch>`; `git.deleteBranch` runs `branch -D`; and
`Dispatcher.createWorktree` constructs the grammar itself —
`flume/<namespace>/<slug>`, or `flume/<slug>` unnamespaced.

The `cherry-pick` half of this ruling was already amended once (d604d55) to
declare fanout's merge as a named carve-out rather than leave it an unnoticed
violation. The branch half was not, and it is the same shape: ephemeral refs
the engine creates, uses, and deletes inside one wave, which no operator ever
sees or chooses.

Needs a human call because it is a doctrine question, not a code question —
nothing is broken either way, but the corpus currently says one thing and
ships another.

Options:

1. **Ratify as a second carve-out.** Amend the ruling the way cherry-pick was
   amended: the prohibition scopes to refs the *operator* chose, and the
   engine's own ephemeral `flume/**` names are recording, not navigating.
   Cheapest, and consistent with how the first carve-out was settled. The
   spec text already reads this way pending the call.
2. **Tighten the ruling's wording instead.** Say the engine never runs
   `checkout`, and never touches a ref outside `flume/**` — which is
   checkable, and would let a gate or sweep lens enforce it rather than
   leaving it prose.
3. **Remove the branch usage.** `worktree add` can operate on a detached
   HEAD, so the `-B` and the grammar could go. Real work, and it would cost
   the readable `git worktree list` output the branch names currently give an
   operator mid-wave.

Recommended: (2). It ratifies the same behavior (1) does, but states the
condition rather than the exception — so the claim becomes something a sweep
can evaluate instead of prose that drifted once already
(`.claude/rules/engineering.md`, *Narration is the ladder's bottom rung*).

## win32 CI lane says "full suite", runs the fast lane (inbox 2026-08-02)

**PARKED**

`.github/workflows/ci.yml`'s windows job comment claims "full suite" but runs
`pnpm test`, which `vitest.config.ts` excludes `**/*.integration.test.ts`
from. `pnpm test:integration` runs only in the ubuntu job, so
`loop-process-boundary.integration.test.ts`, `job.integration.test.ts`, and
`examples.integration.test.ts` (949 lines: subprocess spawn, worktree
provisioning, exit-code boundaries) never run on win32 — the primary dev
platform for this repo, and the platform the `.cmd`-shim spawn defect
(`scripts/smoke-install.mjs`) and `execGate`'s win32 ENOENT shell-retry shim
both came from. The two-lane split itself is declared and reasoned
(`spec/worktrees.md`, *The default test lane must stay fast*); the "full
suite" claim on top of it is not.

Options:

1. **Add `pnpm test:integration` to the windows lane.** Closes the real gap;
   costs win32 CI minutes and imports whatever flakiness the integration lane
   has on a slower runner.
2. **Correct the comment to "fast lane"**, state integration is POSIX-only
   and why. Cheap, honest, leaves the coverage gap standing.
3. **Split**: run the integration lane on win32 non-blocking
   (`continue-on-error`), the pattern the `attw` step already uses with its
   reason named.

Recommended: lean (1) — this is the primary dev platform, and the exact bug
class the integration lane covers (subprocess/worktree spawn) is what has
actually broken here before; (2) alone documents a real gap rather than
closing it. Needs a call on CI-minutes cost, which is not decidable from the
repo alone.

## `plan/pending.json` path: one fact, two homes, and a chain-less tension (inbox 2026-08-02)

**PARKED**

`Dispatcher.ts:1038` hardcodes `join(this.flumeDir, "plan", "pending.json")`.
`builtinGates.ts:323` makes the same path chain-overridable
(`opts.pendingPath ?? join("plan", "pending.json")`). `cli.ts:721`,
`cli.ts:959`, and `job.ts:439` each re-derive the literal a third way. A
chain that overrides `pendingGate`'s path gets a gate reading one file and a
dispatcher writing another — silent desync, not a theoretical risk.

Researched before parking (`.claude/rules/collaboration.md`, *Inform before
parking*): the second-implementation test (`.claude/rules/engine-boundary.md`)
looks at first like it argues for unifying on the capability side — a
single-phase chain (`examples/backlog-groomer-chain.ts`) plausibly wants a
different layout. But `job.ts`'s pending-count read is explicitly a
"chain-less informational read" — `cli.ts`'s status/job commands run without
loading the chain by design, for speed and robustness, and a chain-supplied
override lives inside the chain module those reads never touch. A real
override could not reach the CLI's view without either loading the chain
just to resolve one path (defeats the chain-less design) or accepting the
desync that is already the observed defect. That tension suggests the
override may have been added without accounting for the chain-less reads —
the kind of upstream-decision flag `collaboration.md`'s *Complexity is a
signal* names.

Options:

1. **Treat it as convention, not capability.** Drop `pendingGate`'s override,
   fix `plan/pending.json` as the layout everywhere, one shared constant.
   Closes the desync; costs nothing today since no chain in this repo (or
   `examples/`) actually overrides it.
2. **Keep it a capability end-to-end.** Add the override to
   `DispatcherOptions` too, and give `cli.ts`/`job.ts` a way to know a job's
   override without loading its chain — needs a place to record that outside
   the chain module.
3. **Split.** Capability for the chain-loaded write side (`Dispatcher` +
   `pendingGate`, which must already agree); hardcode the CLI's chain-less
   reads to the fixed convention, with the limitation documented.

Recommended: lean (1) — the override is unused capability whose only
observed effect so far is the desync bug itself, and the chain-less reads
make full unification (2) structurally awkward. Still a call about removing
capability someone deliberately added, so parked rather than decided here.
Per candidate: `.claude/rules/engine-boundary.md` *Capability vs convention*.
