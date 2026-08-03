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
obvious. The zero-declared-files bug is filed separately
(`PENDING-ZERO-FILES-SCHEMA-FLOOR`) and does not wait on this.

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

Per: `spec/chain.md` *The agent seam* now carries this same rationale gap as a
`> **Drift:**` note — the spec section to amend once this lands.

## FLUME_DIR canonicalization skips `job new` and `job status`

**PARKED**

`main()` routes the `job` verbs to `runJobVerb` and returns before
`resolveStateDirs` runs (`src/cli.ts`), so `job new` and `job status` never
canonicalize or write back `FLUME_DIR`/`FLUME_CONFIG_DIR` — yet both load a
real chain, and `job new`'s `loadChainModule` call *invokes* the chain
factory. A factory reading `process.env.FLUME_DIR` (the dogfood chain's
session-capture setup is the shipped example) sees whatever the caller's raw
environment held, not the resolved job state root.

No tick runs under either verb today, so nothing is misplaced in practice
(`spec/chain.md`, *Per-run artifacts belong under `FLUME_DIR`*) — but the
always-present contract a chain author builds against does not hold here.

Options:

1. **Route `job new`/`job status` through `resolveStateDirs` before loading
   the chain.** Matches every other subcommand's guarantee. Needs care:
   `job new` takes the job name positionally, not via `--job`, so the
   resolution call needs the same `--job`-shaped input synthesized from the
   positional arg.
2. **Leave as-is, document the exception.** Cheapest — these two verbs
   already resolve their own `configDir` inline and never run a tick, so the
   gap is real but inert today. Risk: a future chain author trips on it the
   first time a factory reads `FLUME_DIR` during `job new`.

Recommended: lean toward (1) for consistency, but this is a resolution-authority
design call, not a bug with one obvious fix — flagging for a ruling.

Per candidates: `spec/cli.md` *State-root and config-dir resolution*,
`spec/chain.md` *Per-run artifacts belong under `FLUME_DIR`*.
