# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## `src/Dispatcher.ts` (4836 lines) bundles several jobs that read as separate homes (PARKED)

Posture sweep (`.claude/rules/posture-sweep.md` standing lens: "a module carrying jobs that want separate homes") over the `src/Dispatcher.ts` neighborhood found the file's own `// ---------- X ----------` markers delineating distinct concerns: chain load+validate (`:735-1028`), tick-verdict I/O (`:440-600`), singleton tick (`:1601-1943`), fanout tick + per-entry fanout (`:1983-2892`), worktree/friction/prior-attempt helpers (`:2894-4153`), loop supervisor (`:4156-4628`). Sibling engine files stay well under 1000 lines (`git.ts` 651, `Agent.ts` 606, `PendingSchema.ts` 598).

Not filed as a mechanical fix: `Dispatcher.ts:42-44` already documents a constraint that shaped the current structure — `buildFlumeApi` is a function rather than a constant "precisely so" a chain can't resolve a second physical engine, which implies at least the chain-load/`FlumeApi` surface is deliberately colocated with the dispatcher rather than free to split. Whether the tick-execution (singleton/fanout), worktree/friction/prior-attempt, and loop-supervisor concerns share that same constraint, or could split cleanly, needs a design call rather than a sweep-driven guess.

Options:
- **A — split along the marked seams**, keeping only what the `buildFlumeApi` cycle constraint actually requires colocated.
- **B — leave it whole**, treating the file's size as the cost of the single-cycle-avoidance design and citing that constraint as the deliberate divergence (`engineering.md` "The fix lands at the mechanism" allows a declared exception).
- **C — narrower split**: extract only the clearly acyclic concerns (worktree/friction/prior-attempt helpers, loop supervisor) and leave chain-load + tick execution together.

**Answered (2026-09-03, human sign-off):** **sequenced to the line after 0.13.0**, option left
open until the operator opens that line — the same operator-triggered deferral the cli.ts split
took in August. Not declined: unlike Phase.ts this file carries runtime failure modes. Hold out
of pending until the cut ships; git log carries the three options.

## `flume check`'s fence collapses to universal rejection when a chain declares zero fanout phases (PARKED)

`src/cli.ts:1184-1188` derives `check`'s fence from `chain.phases.filter(p => p.concurrency === "fanout")`. Nothing in `src/Phase.ts`'s `Concurrency` type or chain-load validation requires at least one fanout phase — per `spec/pending.md` ("Selection is the sole site; a singleton phase does not pick from pending"), a chain with only singleton phases is structurally legal, it just never consumes `pending.json`. For such a chain, `consumerPhases` is `[]`, `entryWriteScopeUnion([], [])` is the empty fence, and `matchesAny(p, fence)` is `false` for every declared path — so `flume check` would report *every* pending entry as a fence violation, misdiagnosed as "declares files outside the consumer phase's fence" when the real story is "no consumer phase exists." `spec/cli.md`'s `check` description doesn't address this case.

Options:
- **A — vacuous pass.** Zero fanout phases means nothing will ever pick from the queue, so `check`'s fence step has nothing to check; skip it (mirroring how `check` already treats an absent `pending.json`).
- **B — keep rejection, fix the message.** Universal rejection may be the intended defensive posture (a misconfigured chain should be loud), but the message should name "no fanout phase declared" distinctly from "paths outside the fence" so an operator isn't sent chasing the wrong cause.
- **C — enforce the invariant earlier.** If a chain with zero fanout phases and a non-empty `pending.json` is always a misconfiguration, chain-load validation could refuse it outright, making `check`'s current behavior moot.

This repo's own `.flume/chain.ts` always declares one fanout phase (`build`), so the case doesn't manifest here — this is a second-implementation question (`engine-boundary.md`), not a bug against current usage.

## `GateContext.flumeDir` isn't rebased onto the worktree for `afterCommit` gates, unlike `configDir` (PARKED)

`PENDING-GATE-STALE-TIP-READ` fixed `pendingGate` to read the gated commit via
`git.readFileAtRef(ctx.repoRoot, ctx.commitSha, relPath)` instead of a disk read off
`ctx.flumeDir`, where `relPath = relative(ctx.repoRoot, join(ctx.flumeDir, pendingPath))`. That
computation assumes `ctx.flumeDir` is nested under `ctx.repoRoot` — true for the hand-built
`GateContext` fixtures every gate test in this repo already uses (`flumeDir: join(cwd, ".flume")`,
`repoRoot: cwd`), and true for `afterMerge` gates (`repoRoot` is trunk, an ancestor of the
default `<repoRoot>/.flume`).

It is **not** true for `afterCommit` gates in production. `Dispatcher.runAfterCommitGates`
(`src/Dispatcher.ts:3120-3128`) sets `repoRoot: cwd` (the tick's own worktree — every tick,
singleton or fanout, runs in one per `spec/worktrees.md` "Singleton runs in a worktree") but
`flumeDir: this.flumeDir` verbatim — the *primary* checkout's absolute `.flume` path, never
rebased. Since worktrees default to `<flumeDir>/worktrees/<slug>` (`src/Dispatcher.ts:3441`),
`ctx.flumeDir` is an *ancestor* of `ctx.repoRoot`, not nested under it — `relative(ctx.repoRoot,
join(ctx.flumeDir, pendingPath))` yields a path that climbs out of the worktree (`../../plan/
pending.json`), which this fix's own relocation check reads as "outside repoRoot" and falls back
to the disk read — the exact pre-fix behavior — for every real `afterCommit` run. Confirmed
empirically in this worktree: `git show HEAD:.flume/plan/pending.json` (bare, root-relative)
correctly resolves the *worktree's own* tracked copy regardless of cwd nesting; a `../..`-prefixed
path errors `fatal: '...' is outside repository`.

`configDir` doesn't have this problem — `Dispatcher.runAfterCommitGates` rebases it explicitly:
`join(cwd, relative(this.opts.repoRoot, this.opts.configDir))` (`src/Dispatcher.ts:3114-3117`).
`flumeDir` wants the identical treatment, mirroring the already-established
`stateRootRel = relative(this.opts.repoRoot, this.flumeDir)` pattern `harvestFriction`
(`src/Dispatcher.ts:3245`) already uses to read a worktree-local tracked file via
`git.readFileAtRef` correctly.

Out of scope for `PENDING-GATE-STALE-TIP-READ`: its fence is `src/builtinGates.ts` +
`tests/**`, and this fix belongs in `src/Dispatcher.ts`'s `GateContext` construction (and
possibly `Gate.ts`'s doc comment, which — unlike `configDir`'s — doesn't currently promise
`flumeDir` is rebased per-worktree). Until it ships, `pendingGate`'s new commit-sha read is
correct but dormant in production: every real `afterCommit` run still falls back to the disk
read this entry was filed to retire.

Options:
- **A — rebase `flumeDir` the same way as `configDir`** at both `runAfterCommitGates` call sites,
  and update `Gate.ts`'s `flumeDir` doc comment to state the same per-worktree contract
  `configDir` already documents.
- **B — leave `flumeDir` un-rebased** and instead give `GateContext` a distinct field for "the
  primary repoRoot flumeDir is anchored to," so a gate can compute the tracked-relative offset
  itself without assuming nesting either way.

**Answered (2026-09-03, human sign-off):** **B, with the offset computed by the engine, not the
gate** — ratified in `spec/chain.md` *What a gate receives* (commit carrying this answer).
A is wrong on its own terms: `flumeDir` is where runtime state lives (`awake/`,
`prior-attempts/`, verdicts), which exists only in the primary checkout, so rebasing it onto a
worktree breaks every gate that reads runtime state to fix one that reads a tracked file.
`GateContext` gains `stateRootRel` — the `relative(repoRoot, flumeDir)` the friction harvest
already computes, shared not re-derived (`engineering.md`, *The fix lands at the mechanism*) —
set only when the state root is inside the repo. `pendingGate` reads
`git show <commitSha>:<stateRootRel>/<pendingPath>` and keeps the `flumeDir` disk read only for
the relocated case. Derivable now; the fix's test must build the context the way
`runAfterCommitGates` does (`flumeDir` an ancestor of the worktree `repoRoot`), since the
shipped test's nested fixture is exactly what let the dormant fix ship green
(`engineering.md`, *A seam gate reads what the real writer wrote*). Question closes when it
ships.
