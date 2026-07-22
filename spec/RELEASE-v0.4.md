# Flume — v0.4.0 Release Target

## 1. Purpose & scope

Four themes, grouped because they share one posture — **the harness must be
trustworthy when nobody is watching**:

- **Loop safety (Axis C).** A misconfigured baton must terminate the loop
  loudly, not hot-spin or masquerade as clean hibernation (§3).
- **Delegation seams.** Phases may run different agents/models — the
  architect/editor cascade the plan/build norm already encodes (§4).
- **Containment.** A fanout tick's write authority narrows to the entry it
  was assigned, not the phase-wide union (§5).
- **Portability.** win32 is a supported host; the suite proves it (§6).

§2 additionally records public surface that shipped ahead of spec — the
0.2.0-forked runtime fixes reconciled by PR #5 and the v0.1.2 worktree
hooks — so every element of the live API carries spec authority again.
Recording is not re-derivation: the surface is shipped and frozen in shape;
what plan derives from §2 is only its **test and documentation gaps**.

## 2. Shipped surface, recorded here

Precedent: v0.3 §11 (relocation surface, "landed; recorded here").

### 2a. PR #5 reconciliation (merged post-0.3.0)

- **`FLUME_WORKTREES_DIR`** (env): overrides the fanout worktree base dir.
  Default remains `<flumeDir>/worktrees` (§16's relocatable state root);
  the override exists for consumers that must place ephemeral worktrees
  outside every repo-path prefix (the observed stray-write vector: an agent
  whose pwd contains the root checkout's path derives the root and operates
  there). Resolution: `FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")`
  (`src/Dispatcher.ts` `createWorktree`).
- **Cross-process loop lock**: `flume loop` writes `<flumeDir>/loop.pid`;
  a second loop against the same state root is refused while the recorded
  pid is alive; a stale pidfile (dead pid) is reclaimed. The lock lives
  under `flumeDir`, not the repo — the state root is what races, and a
  relocated dock carries its lock with it (`src/cli.ts` `cmd === "loop"`).
- **`PendingEntry.observedFiles`** (`src/PendingSchema.ts`): the *actual*
  commit footprint of a reverted attempt, persisted on the entry so the
  next partition separates the retry from what it collided with even where
  declared `files` under-stated the reach. Written by the dispatcher on
  merge-failure revert; read by the partition alongside `files`.
- **`TickResult.revertedTags`**: tags reverted this wave, exposed so
  merge-thrash vs in-session retry is telemetry-visible.
- **Wave auto-unblock**: ship bookkeeping opens `blockedBy` gates whose
  blocker shipped in the same wave — a chained entry advances without a
  plan interim tick.
- **No-op footprint update**: a footprint-only pending update that changes
  nothing must not report the pre-existing HEAD as its commit.

### 2b. v0.1.2 worktree hooks (OQ backfill)

Shipped in `@dtmd/flume@0.1.2` (`ab2f10f`), exported from `src/index.ts`,
never specced: `Phase.teardownWorktree?(ctx)` (best-effort per-worktree
cleanup), exported type `WorktreeSetupResult`, and `setupWorktree` may
return `{ extraEnv }` (threaded into the tick's agent invocation). Recorded
against this line because v0.1 and v0.2 are frozen; the OQ's process note
stands — out-of-band feature commits during fork reconciliation are how
this bypassed plan, and §2 is the standing landing pattern for that class.

### 2c. Derivable gaps

Plan derives from §2 only: (i) tests asserting each §2a behavior where the
merged suite left holes (the PR carried tests for partition/schema; the
loop lock and worktree-base override have none), (ii) README /
CHAIN-AUTHORING coverage of `FLUME_WORKTREES_DIR`, the loop lock, and the
`{ extraEnv }` seam. No shape changes are authorized by this section.

## 3. Axis-C terminal misconfiguration (orphaned baton)

Flume's outcomes travel three axes: **A** work outcome (commit /
no-commit union, per-entry, retryable, §5-§6 of v0.2), **B** clean
quiescence (`hibernated`, exit 0, supervisor stops), **C**
precondition/config error (the declared world is inconsistent;
deterministic, non-retryable). §3 of v0.2 built half of Axis C
(chain-resolution failure → `failed: true`, exit 1). An awake flag naming
a phase the chain does not declare is the other half, today mis-routed
onto Axis B: the tick reports `hibernated: true`/exit 0 while the flag
stays on disk, so `superviseLoop` — whose only stop signal is
`baton.hibernating()` — never stops, and the loop hot-spins to `--max`.
The §5/§6 (Axis-A) framing is explicitly rejected: no agent ran, no entry
exists to retry, and `TickOutcome.noCommit` is documented absent when no
agent ran.

Mandated shape:

- **`TickOutcome.terminal?: { kind: "orphaned-awake"; phases: string[] }`**
  — a typed terminal-misconfiguration outcome, sibling to `hibernated` /
  `failed`, never a `NoCommitMode` member. `kind` is a union open to
  future Axis-C members; `"orphaned-awake"` is its founding member.
- **`flume tick` exits `78`** (`EX_CONFIG`, sysexits.h) when
  `terminal` is set — distinct from 0 (clean hibernate) and 1 (§3
  resolution failure), so the caller classifies the failure without
  reading logs.
- **`superviseLoop` fail-fasts on the child's exit signal** — exit 78
  stops the loop immediately with a summary naming the orphaned phases.
  The supervisor must not consult `baton.hibernating()` for this decision;
  the orphaned flag definitionally defeats it.
- **The orphaned flag stays on disk.** Clearing it would convert the
  misconfiguration into a silent clean stop (the silent-ack anti-pattern).
  The human inspects, then `flume sleep <phase>` or fixes the chain.

## 4. Per-phase agent assignment

- **`Phase.agent?: Agent`** (`src/Phase.ts`). Per-tick resolution:
  `phase.agent ?? chainModule.agent ?? opts.agent` — extends the existing
  chain-level override chain (`src/Dispatcher.ts:394`) by one inner scope.
- Mechanism over sugar: an `Agent` composes with decorators (the dogfood
  chain wraps `claudeCode` in `withTerminalRenderer(withSessionCapture(…))`;
  a bare model string cannot express "same decorators, different model").
  A `Phase.model` string shortcut is **deferred** until a second provider
  or demonstrated ergonomic pain exists (§8).
- A model-only variation is already expressible per phase with this seam:
  `claudeCode({ extraArgs: ["--model", "…"] })` inside the phase's agent
  value. CHAIN-AUTHORING.md documents the pattern, including a chain-local
  helper that amortizes re-stating the decorator stack.
- First consumer: flume-dock's sweep preset (plan on a mid-tier model,
  build on a cheap one) — aider's architect/editor split is the validated
  prior art.

## 5. Entry-scoped fanout write guard

For a fanout tick carrying an `assignedEntry`, the post-commit write guard
narrows from the phase-wide `writablePaths` union to:

    entry.files.{new,edit,retire} paths
    ∪ Phase.entryChannelPaths (see below)
    — with phase writablePaths as the outer ceiling (both checks apply)

Singleton ticks keep phase-wide scope unchanged.

- **`Phase.entryChannelPaths?: string[]`** — globs always writable on a
  scoped tick regardless of the assigned entry's declaration. The channel
  allowance for cross-tick artifacts the entry never declares (e.g. the
  dogfood build phase lists `.flume/plan/open-questions.md`). Default `[]`.
- **`files` becomes load-bearing — a plan-side obligation.** Enforced
  scope changes what plan must guarantee when authoring entries: declared
  `files` must include every path the work legitimately touches, including
  incidentals (lockfile, barrel export). Plan's prompt/schema text states
  this obligation; an entry that under-declares is a plan defect, not a
  guard defect.
- **Failure semantics**: identical to the existing writable-paths guard —
  whole-commit revert — and the §5 prior-attempt feedback block must name
  the out-of-scope path(s), so the retry (or the next plan audit) sees
  exactly which path fell outside scope.
- **Rollout**: enforced from the first release (option A). Warn-first was
  considered and rejected: the §5 feedback block already gives the retry
  path everything a warning would, with teeth (§9).

## 6. win32 portability

flume's runtime and suite are **supported on win32**; POSIX remains the
primary CI target. Normative consequences:

- **Spawn discipline.** Package-manager binaries are `.cmd` shims on
  Windows, which Node refuses to spawn without a shell (CVE-2024-27980).
  Any runtime spawn of a non-exe binary goes through the direct-spawn →
  win32-ENOENT → shell-retry fallback (`execGate`, `src/builtinGates.ts`)
  or an equivalent platform-conditional; bare `execFile("pnpm", …)` is a
  defect.
- **Path discipline.** No `"/"`-splitting of filesystem paths — leaf
  extraction is `basename()`, comparison happens on `join()`-built or
  normalized forms. Exception: git porcelain output prints forward slashes
  on every platform and is asserted against literally.
- **Test-repo hygiene.** Temp git repos pin `core.autocrlf false` (and any
  future byte-sensitive config) so revert-path byte assertions survive
  host-level config.
- **CI lane.** `.github` workflows gain a `windows-latest` job running
  `pnpm tsc --noEmit && pnpm test`; the win32 commitment is only real
  while a red Windows suite blocks a merge.

## 7. Tests

- §3: orphaned-awake tick → `terminal.kind === "orphaned-awake"`, exit 78,
  flag still on disk; `superviseLoop` stops on the child's 78 with the
  orphaned phase named in its summary; clean hibernation still exits 0.
- §4: a chain with `phase.agent` set uses it for that phase and the
  default elsewhere; `chainModule.agent` still overrides `opts.agent` when
  the phase is silent.
- §5: scoped tick committing inside `files` ∪ channel ships; a commit
  touching a path outside scope (but inside phase globs) reverts, and the
  retry prompt names the path; singleton ticks unaffected; ceiling still
  binds (a path inside `files` but outside phase globs reverts).
- §2c: loop-lock (second loop refused while pid alive; stale pid
  reclaimed) and `FLUME_WORKTREES_DIR` override placement.
- §6: covered by the CI lane rather than new unit tests.

## 8. Non-goals for 0.4.0

- `Phase.model` string sugar (§4) — deferred.
- Warn-first rollout mode for the scoped guard (§5) — rejected, see §9.
- Any new Axis-C `kind` beyond `"orphaned-awake"` — the union is open,
  members arrive with their own spec sections.
- POSIX-parity CI matrix beyond the single windows-latest lane.

## 9. Resolved decisions

1. **Exit code for Axis C is 78** (`EX_CONFIG`), not a reuse of §3's 1:
   the two Axis-C members are distinguishable at the process boundary,
   which is the entire point of the axis.
2. **Orphaned flag is left on disk** — diagnosability over tidiness; the
   supervisor stops on the exit signal, never on re-reading broken state.
3. **Per-phase delegation is an `Agent` value, not a model string** —
   composition with decorators wins; sugar waits for demonstrated need.
4. **Scoped guard ships enforced** (no warn-first release): under-declared
   entries are plan defects the §5 feedback loop already surfaces, and a
   non-enforcing release trains plan on the wrong contract.
5. **Channel allowance lives on `Phase`** (`entryChannelPaths`), not chain
   level: it is a per-phase writing posture, the same home as
   `writablePaths`.
6. **PR #5 surface and v0.1.2 hooks are recorded, not re-derived** (§2):
   recording shipped surface in the live line is the standing pattern for
   fork-reconciliation commits that land ahead of spec.
