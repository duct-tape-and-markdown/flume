# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-08-03 — a tick that dies mid-flight reports a clean stop (operator)

`superviseLoop` accumulates `erroredTicks` only from on-disk verdicts, so a
child that exits non-zero *without writing one* is invisible to the run total,
and `loopExitCode` returns 0.

Two live paths reach it. A throwing chain hook (`gate.run`, `handoff`,
`promptArgs`, `shouldRun`) propagates uncaught out of `Dispatcher.tick` — no
verdict, and because `baton.sleep(phase)` already ran while `handoff` never
reached the successor, **the baton is left empty**. `Baton.hibernating()` is
then true, so the loop stops and reports a clean hibernation. Separately, a
CJS-context host burns every `--max` tick and still exits 0.

Disk-is-truth means the work is re-runnable; the defect is that nothing tells
the operator to re-run. `spec/loop.md` *Exit codes* says the run never lies to
CI, and here it does — the class `.claude/rules/engineering.md` (*Loud or
nothing*) forbids outright.

Smallest fix that closes both: the supervisor counts a non-zero child exit as
an errored tick whether or not a verdict was written. Prefer that to wrapping
every hook — a hook throwing is not itself wrong, the silence is.

Per candidate: `spec/loop.md` *Exit codes*. Test: a child exiting non-zero with
no verdict on disk makes the run exit non-zero.

## 2026-08-03 — an entry declaring zero files can never ship (operator)

`files.new`/`edit`/`retire` all default to `[]`, so an entry declaring nothing
parses clean and is pickable. Ship detection then diffs the merged commit
against `declaredPaths(entry)`, which is empty, so overlap is always zero and
the entry is never classified shipped. It commits real work every wave, the
work lands on trunk, and the entry stays at the head of the queue forever.

A live loop, not a theoretical one — CHAINTS-PREDICATE-COVERAGE is in the queue
right now with empty `files`, because its work is tests and those rode the
channel.

Two candidate fixes, not equivalent: require at least one declared path at the
schema, or treat zero-declared as "the gates decide". The second composes with
the ship-classification open question; the first is independent and cheap.
Prefer the schema floor unless that question lands first.

Per candidate: `spec/pending.md` *Ship detection requires a declared-files
diff*. Test: an entry with empty `files` that commits inside the fence is
either rejected at parse or classified shipped — never silently re-picked.

## 2026-08-03 — three chain-surface gaps (operator)

Independent and mechanical, grouped only because each is a one-line surface
correction.

- **`maxParallel` is programmatic-only and unvalidated.** `opts.maxParallel ?? 4`
  in `Dispatcher`, no chain declaration and no floor — a declared `0` wedges the
  wave silently. `.claude/rules/engine-boundary.md` says policy constants enter
  as chain-overridable defaults, and `quarantineScope` / `abortThreshold`
  already do. Make it a `supervisorPolicy` sibling; validate `>= 1`.
- **An afterMerge gate on a singleton phase is silently inert**, but
  `prependHarnessBlock` renders `phase.gates` unfiltered, so the prompt tells
  the agent a gate will judge its commit when nothing will run it. Same class as
  the fence narration overstating enforcement, and `spec/prompt.md` claims the
  block never misstates its own enforcement. Filter the render, refuse at chain
  load, or both.
- **`claudeCode()`'s skip-permissions rationale is false.** The default itself
  is an open question (parked); the comment justifying it is wrong today
  regardless — it claims every tick runs in a harness-controlled worktree, which
  singleton phases do not.

Per candidates: `spec/chain.md` *Supervisor policy is a chain-overridable
default* and *What a gate receives*; `spec/prompt.md` *The harness block*.

## 2026-08-03 — `--job <name>` materializes a state root on any subcommand (operator)

`--job typo` resolves `FLUME_DIR` to `.flume/jobs/typo` and the runtime creates
it on first write, so a mistyped name on a *read* command becomes a real job
directory that `flume job status` then lists as legitimate. Nothing refuses.

`job new` is the creation verb. Every other subcommand under `--job <name>` (or
`FLUME_JOB`) should refuse a name with no existing state root — usage error,
exit 2, naming the job and the path it looked for. Silent materialization on a
read path is the same degradation class as a substituted placeholder.

Per candidate: `spec/jobs.md` *A job is a state root*, plus `spec/cli.md`
*Subcommand surface* for the exit-2 list. Test: `flume --job nonexistent status`
exits 2 and creates no directory; `flume job new nonexistent` still creates one.

## 2026-08-03 — remove `flume render` (operator ruling)

`render` is deleted, not repaired. Operator ruling 2026-08-03.

It is a preview that lies. It never passes `assignedEntry`, so a scoped tick's
prompt previews with the unscoped fence; it never passes `priorAttempt`, so a
retry always previews as a first attempt; and its default entry pick re-derives
pickability as `gate.kind === "open"`, disagreeing with `Dispatcher.isPickable`
in both directions. Making it honest means threading the tick's whole setup path
into a dry run — a second implementation of tick selection that will drift the
same way again.

It is also none of the four things the engine does: instantiate an agent, hand
it a prompt, check the commit against configuration, decide where to spawn next.

The validation use it actually served — "does chain.ts load and the template
resolve" — is already covered: `flume status` loads the chain, and CI's smoke
lanes drive a real `tick`.

Remove: the `render` branch in `src/cli.ts` and its arg parsing, `HELP_SUB.render`
and its `HELP_TOP` line, the render entry in `docs/CLI.md`, and every test
asserting the subcommand. `renderPrompt` itself stays — it is the tick's own
render path and a public export. Breaking CLI change; the changelog is built
from git at the cut, so the commit body is the record.

Per candidate: `spec/cli.md` *Subcommand surface*. Test: `flume render`
is an unknown subcommand (exit 2), and no help text names it.

## 2026-08-03 — exit-code contract (5 defects) (equilibrium audit)

Confirmed against `src/` during the spec/code equilibrium pass; each has a
`> **Drift:**` note in the cited spec section asserting the contract the code
breaks. Split into separate entries if they partition badly — the point is that
they share a root, not that they must ship together.

- **[cli]** `flume job new` exits 1 on the CJS-context refusal instead of the uniform 2, and prints it behind `[flume] job new failed:` rather than as the headline; `render` and `tick` both return 2. Fix is one `instanceof CjsContextLoadError` branch before the operational catch, plus a test driving `job new` against a CJS-context host that fails on the pre-fix tree.
  - symbol: `src/cli.ts:runJobVerb (the `verb === "new"` catch); reached via src/job.ts:jobNew â†’ src/Dispatcher.ts:loadChainModule`
- **[cli]** Runtime help text omits two exit-2 cases the file documents: `HELP_SUB.tick` lists 0/1/69/78 and never mentions the 2 `tickExitCode` returns on `TickOutcome.usageError` (the CJS refusal); `HELP_SUB.render` names 2 only for a missing/unknown phase and an unmatched `--entry`, not for the unparsable-`pending.json` refusal the same branch performs.
  - symbol: `src/cli.ts:HELP_SUB.tick and src/cli.ts:HELP_SUB.render`
- **[loop]** flume tick's detached-HEAD refusal returns above the clearTickVerdict call â€” the one early return that leaves the previous tick's verdict on disk, so a loop whose HEAD is detached mid-run re-reads the stale record every iteration (and can drive provisionFailureStreak to abortThreshold on a spurious signature).
  - symbol: `src/cli.ts (tick command: currentRefPath refusal precedes clearTickVerdict)`
- **[loop]** erroredTicks accumulates only from on-disk verdicts, so a child exiting non-zero without writing one (CJS refusal exit 2, detached-HEAD exit 1, chain-load failure, uncaught throw) contributes nothing. With a phase left awake the supervisor warns and iterates through every --max tick, and loopExitCode returns 0 over a run in which nothing succeeded.
  - symbol: `src/Dispatcher.ts:superviseLoop (the exitCode !== 0 warn-and-continue branch), src/cli.ts:loopExitCode`
- **[loop]** currentRefPath returns null for a detached HEAD, a non-repository cwd, and a git that fails to run; both CLI call sites print 'HEAD is detached' for all three, so a caller outside a repository is told about a state it is not in.
  - symbol: `src/git.ts:currentRefPath, src/cli.ts (tick and loop branches)`

Each fix ships the test that would have caught it
(`.claude/rules/engineering.md`). `per` cites the drift-noted section.

## 2026-08-03 — render preview diverges from the tick (2 defects) (equilibrium audit)

Confirmed against `src/` during the spec/code equilibrium pass; each has a
`> **Drift:**` note in the cited spec section asserting the contract the code
breaks. Split into separate entries if they partition badly — the point is that
they share a root, not that they must ship together.

- **[cli]** `render`'s default entry pick re-derives pickability as `gate.kind === "open"`, disagreeing with the dispatcher in both directions: it renders entries the tick would skip (unresolved `dependsOnForks`) and refuses with `no open entries in pending.json` over a queue the tick has work in (`blockedBy` with a shipped blocker, asserted `requiresCapability`). The render branch already holds `pending` and the `ChainModule`, so the predicate can be shared. Caution for whoever picks this up: `isPickable` is module-private in Dispatcher.ts and the public `isPickableNow` (src/PendingSchema.ts) keys `blockedBy` on a shipped-tags set rather than pending membership â€” there are already two readings of this rule, so the fix should land on one, not add a third.
  - symbol: `src/cli.ts main() `cmd === "render"` branch vs src/Dispatcher.ts:isPickable (call site: runFanout)`
- **[chain]** Renders phase.gates unfiltered into the <harness> block, so a singleton phase's prompt names an afterMerge gate as enforcement when nothing will run it â€” against spec/prompt.md's claim that the engine's one authoritative prompt surface never misstates its own enforcement.
  - symbol: `src/Prompt.ts:prependHarnessBlock`

Each fix ships the test that would have caught it
(`.claude/rules/engineering.md`). `per` cites the drift-noted section.

## 2026-08-03 — wave durability (3 defects) (equilibrium audit)

Confirmed against `src/` during the spec/code equilibrium pass; each has a
`> **Drift:**` note in the cited spec section asserting the contract the code
breaks. Split into separate entries if they partition badly — the point is that
they share a root, not that they must ship together.

- **[loop]** Tip verify's parent comparison decides only a single-commit tick. An agent making two commits in one invocation trips checkTipMoved (parent(C) != recorded tip), and revertTipMovedCommit soft-resets exactly one commit â€” leaving the first on the tip, un-gated, while the tick reports committed:false and skips runAfterCommitGates entirely. Nothing counts a tick's commits.
  - symbol: `src/Dispatcher.ts:checkTipMoved, src/Dispatcher.ts:revertTipMovedCommit, src/git.ts:softReset`
- **[loop]** commitPendingUpdate's strict readPending throws PendingParseFailure past runFanout's teardown into tick()'s catch, which returns before the verdict is built â€” so a wave that ran N agents and cherry-picked their commits onto the tip writes no verdict, and its shipped tags never reach the run totals.
  - symbol: `src/Dispatcher.ts:commitPendingUpdate, src/Dispatcher.ts:tick (PendingParseFailure catch), src/Dispatcher.ts:superviseLoop`
- **[loop]** The consecutive-identical-failure backstop compares only provisionFailures[0]?.signature, so a tick recording several failures contributes only its first. A signature repeating on every tick behind a varying sibling at index 0 never accumulates a streak â€” and runFanout emits multi-failure ticks by construction (repo-level prune failure first, then one per failing createWorktree).
  - symbol: `src/Dispatcher.ts:superviseLoop (lastProvisionSignature / provisionFailureStreak)`

Each fix ships the test that would have caught it
(`.claude/rules/engineering.md`). `per` cites the drift-noted section.

## 2026-08-03 — friction harvest + retired vocabulary (4 defects) (equilibrium audit)

Confirmed against `src/` during the spec/code equilibrium pass; each has a
`> **Drift:**` note in the cited spec section asserting the contract the code
breaks. Split into separate entries if they partition badly — the point is that
they share a root, not that they must ship together.

- **[worktrees]** harvestFriction composes the destination as `${tag}--${file.name}` with no exists-check; `rename` (and the EXDEV fallback's `copyFile`) replaces an existing destination silently, so a retried entry whose agent writes the same filename destroys the earlier, still-unread operator note. writeRevertNote writes into the same directory with an ISO stamp and is collision-free by construction â€” the two writers disagree on whether uniqueness matters.
  - symbol: `src/Dispatcher.ts:harvestFriction (contrast src/Dispatcher.ts:writeRevertNote)`
- **[worktrees]** The JSDoc above harvestFriction repeats the same overstated claim the spec sentence carried â€” "prefixed `<tag>--` for provenance and collision-freedom". It is the second home of a claim the code does not deliver; it should shrink to whatever the fix above settles on.
  - symbol: `src/Dispatcher.ts:harvestFriction (docstring)`
- **[worktrees]** The header comment carries the retired placement claim: "is exactly what the build's `afterMerge` gate (`pnpm test` = `vitest run`) invokes inside the fanout worktree, so it must stay fast and worktree-safe". The gate runs with `cwd: repoRoot`; nothing runs the default vitest lane inside a worktree.
  - symbol: `vitest.config.ts (top-of-file comment)`
- **[chain]** The afterMerge member's doc still reads "Failure reverts the merge wave on the trunk" â€” the contract retired by per-entry isolation; src/Dispatcher.ts:runFanout hardResetTo(repoRoot, preCherry) drops only the offending entry and leaves clean siblings shipped. No note added to chain.md: spec/worktrees.md owns the retired-vocabulary enumeration (it already lists Phase.Concurrency, Phase.gates, GateContext.cwd) and this is a fourth site for that list, not a chain.md note.
  - symbol: `src/Gate.ts:GatePhase`

Each fix ships the test that would have caught it
(`.claude/rules/engineering.md`). `per` cites the drift-noted section.

## 2026-08-03 — resolution + surface gaps (5 defects) (equilibrium audit)

Confirmed against `src/` during the spec/code equilibrium pass; each has a
`> **Drift:**` note in the cited spec section asserting the contract the code
breaks. Split into separate entries if they partition badly — the point is that
they share a root, not that they must ship together.

- **[cli]** The FLUME_DIR / FLUME_CONFIG_DIR write-back never runs on the `job new` and `job status` paths â€” `main()` returns `runJobVerb` before `resolveStateDirs` â€” yet both branches load a real chain, and `job new` invokes the chain factory. A factory reading `process.env.FLUME_DIR` sees the caller's raw environment. Closure direction is an operator call (see needsOperator).
  - symbol: `src/cli.ts main() (the `cmd === "job"` block's `return runJobVerb(rest, repoRoot)`), src/cli.ts:runJobVerb, src/job.ts:jobNew â†’ src/Dispatcher.ts:loadChainModule`
- **[cli]** All three chain fixtures CI installs the packed tarball against still end in `export default chain;` with `chain` an object literal, which `loadChainModule` refuses outright with the pre-0.11 migration message â€” so the chain-load leg cannot pass as written. The existing Drift note named only two; amended to name the third, which drives a real `wake` + `tick` and asserts on committed output. All three owe `export default (api) => ({ chain })`.
  - symbol: `scripts/smoke-install.mjs:CHAIN_FIXTURE; .github/workflows/ci.yml steps "Consumer-install smoke" and "Second reference chain smoke (backlog-groomer)"; refusal at src/Dispatcher.ts:loadChainModule`
- **[chain]** Justifies the skip-permissions default as "every Flume tick runs in a worktree the harness controls", which is false for singleton phases â€” they run in the primary checkout (spec/worktrees.md), and in this repo plan is singleton.
  - symbol: `src/Agent.ts:ClaudeCodeOptions`
- **[chain]** shellGate/tscGate/vitestGate/eslintGate are exported as values but ShellGateOptions, PkgManagerOverride, and PkgManagerGate are not on the export list â€” and ShellGateOptions is not exported from its own module at all. A consumer can call these gates but cannot name the shape it passes them, unlike PendingGateOptions beside them.
  - symbol: `src/index.ts / src/builtinGates.ts:ShellGateOptions`
- **[chain]** main() dispatches the job-management verbs and returns before reaching resolveStateDirs, so `flume job new` and `flume job status` load the chain with FLUME_DIR/FLUME_CONFIG_DIR uncanonicalized. Filed as drift rather than fixed because the semantics choice is an operator question (above).
  - symbol: `src/cli.ts:runJobVerb`

Each fix ships the test that would have caught it
(`.claude/rules/engineering.md`). `per` cites the drift-noted section.
