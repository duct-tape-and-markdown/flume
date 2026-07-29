# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0: minor versions may introduce breaking changes to the public API surface
(see `spec/RELEASE-v0.1.md` §2). Breaking changes land under a `### Breaking`
subheading per `spec/RELEASE-v0.1.md` §9.

## [Unreleased]

### Added

- `GateContext.repoRoot` — the absolute path of the working-tree root a
  gate is running in (worktree root under fanout, primary checkout under
  a bare tick), so gates stop reinventing the `git rev-parse
  --show-toplevel` + fallback helper themselves.

### Fixed

- An entry-scoped fanout tick's rendered `<harness>` block now states the
  **effective** fence — `entry.files ∪ phase.entryChannelPaths` — that the
  write guard actually enforces, naming `phase.writablePaths` separately as
  the outer ceiling. Previously the block only ever showed the wider
  `writablePaths`, misstating the guard's narrower revert boundary on
  scoped ticks. Unscoped ticks render unchanged.
- `"prepack": "pnpm build"` — `npm pack` (and `pnpm smoke:install`) now
  rebuilds `dist/` before packing instead of shipping whatever happens to
  be on disk.
- CLI's invoked-directly check now compares `import.meta.url` against the
  **realpath** of `process.argv[1]` instead of the raw path, so
  `dist/cli.js` reached through a directory junction or symlink (pnpm's
  linked store) still runs `main()` instead of silently exiting 0.
- A cherry-picked commit that touches only a phase's declared channel
  paths (a park note, no implementation) no longer classifies as
  shipped — the diff is checked against the entry's declared
  `files.{new,edit,retire}` before it's removed from `pending.json`, so
  the entry stays pending for a real attempt.

## [0.6.2]

Patch: the friction channel's lifecycle, guaranteed by the engine without
ever reading its content, plus win32 worktree-teardown integrity. See
`spec/RELEASE-v0.6.2.md`.

### Added

- `Chain.friction?: string` — a state-root-relative directory declaring
  the friction channel (loop-to-owner notes, gitignored, hand-routed by
  the operator). Validated relative and inside the state root at chain
  load; undeclared leaves every behavior below off.
- Runtime ignore entries fold in the declared friction dir alongside the
  existing template-authored lines, uniformly gitignored by machinery.
- Teardown harvest: before a fanout worktree is removed, every file in
  its worktree-local mirror of the declared friction dir is moved into
  the primary `<flumeDir>/<friction>/`, prefixed `<tag>--` for
  provenance. A locked or unreadable file is logged and skipped rather
  than aborting the wave.
- Revert notes: when an afterCommit gate reverts a build tick's commit
  and `Chain.friction` is declared, the engine writes
  `<friction>/<ISO-timestamp>--<tag>--reverted.md` with the gate name,
  message/details, and the reverted commit's subject + body — the
  operator's copy of the verdict, previously visible only in supervisor
  stdout.
- `flume status`, `flume job status`, and loop/job-run completion
  summaries append a friction count line (e.g. `friction: 3 note(s)
  await routing`) when the channel is declared and non-empty.
- `job extract` prints the declared friction dir's files (path +
  contents) in place of the legacy hardcoded `friction.md` guess;
  undeclared chains keep the prior behavior unchanged.

### Fixed

- win32: `git worktree remove --force` failing with `Directory not
  empty` (typically a pnpm-installed `node_modules`) now falls back to
  `git worktree prune` plus a bounded-retry recursive removal instead of
  leaving debris for a hand sweep; a surviving directory is reported
  once per wave, not once per tick.

## [0.6.1]

Patch: the Windows install surface. See `spec/RELEASE-v0.6.1.md`.

### Fixed

- `npm i -g @dtmd/flume` now yields a working `flume` on Windows: the
  package's bin was `#!/bin/sh`, so npm's generated `.cmd`/`.ps1` shims
  hunted for `sh.exe` and failed under PowerShell/cmd on a stock Windows
  box with no `sh` on PATH.

### Added

- `smoke:install` — a pack-and-install smoke test exercising the
  npm-generated shims and a chain load, closing the gap that let 0.6.0
  ship with a dead Windows entry point.

## [0.6.0] - 2026-07-23

Static-`.flume` + thin jobs, the native shape: a chain is a repo-resident
artifact, one chain per `.flume`, known by location, with job dirs holding
only job state. Driven by the centercode-platform static-`.flume` dogfood.
See `spec/RELEASE-v0.6.md`.

### Breaking

- Job resolution (`--job`/`FLUME_JOB`) no longer retargets
  `FLUME_CONFIG_DIR` — it moves only `flumeDir` (state root); `configDir`
  stays `<repoRoot>/.flume` or explicit `FLUME_CONFIG_DIR`. Chains are
  repo-resident: a `chain.ts` inside a job dir is never read (inert by
  construction — no probe, no warning). The v0.5 conflict rule conflated
  state authority with config authority; job-local chain shims (`export
  { default } from "../../chain.ts"`) are no longer necessary and can be
  deleted at leisure.
- `flume job new --template <dir>` removed. Seed authority moves from a
  per-invocation flag to the repo chain's declared `seedDir` (see
  `### Added`); `job new` now requires a repo chain to exist at all — a
  job that could never `run` must not be creatable.
- `flume job extract` harvests only chain-declared paths. The hardcoded
  `HARVEST_PATHS` constant (`friction.md`, open questions) is removed;
  absent a declared `harvest`, extract harvests nothing — no default.

### Added

- `Chain.seedDir?: string` — a configDir-relative directory copied
  verbatim into a newborn job dir on `job new` (skip-existing, so re-run
  fills gaps introduced by a stub added later without clobbering worked
  files). Absent `seedDir` produces a bare job, no warning. A missing
  repo chain, or a declared-but-absent `seedDir`, is a usage error
  (exit 2).
- `Chain.harvest?: string[]` — job-dir-relative paths `job extract`
  copies off a dying job branch to stdout for operator routing. Extract
  loads the repo chain for the list before any git mutation, so a
  broken/missing chain fails usage-shaped (exit 2) and leaves the job
  untouched, same as the other pre-flight checks.
- `--job` composes with an explicit `FLUME_CONFIG_DIR`: env owns the
  chain+prompts dir, job owns state, no corruption scenario (state stays
  namespaced under the job dir). `--job` alongside explicit `FLUME_DIR`
  remains a usage error (exit 2) — two authorities for one state root.

## [0.5.0] - 2026-07-23

The dock collapse: a job is a branch plus a state root, both named by
convention — `.flume/jobs/<name>/` on branch `job/<name>` — and a
`flume job` verb family operates the lifecycle, so the wrapper repo the
machinery used to live in retires. Consolidates the uncut v0.4 surface
(0.4.0 was never published) with the v0.5 surface. See
`spec/RELEASE-v0.4.md` and `spec/RELEASE-v0.5.md`.

### Breaking

- `DispatcherOptions.trunkBranch` removed — it was dead code (stored,
  consumed nowhere). The trunk contract is HEAD-is-truth: commits land
  on the checked-out branch of the working tree the loop runs in; the
  runtime never switches branches. Checkout is a human/verb act.

### Added

- `flume job` verb family — machinery only, no harness content
  (templates stay caller-owned):
  - `job new <name> [--template <dir>]`: create/reuse branch
    `job/<name>` from HEAD, seed `.flume/jobs/<name>/` from the
    template, ensure runtime ignore entries (`awake/`,
    `prior-attempts/`, `worktrees/`, `node_modules/`, `loop.pid`),
    provision a junction/symlink `@dtmd/flume` → the running CLI's own
    package root (version coherence), and baseline-commit the seeded
    harness scoped to the job dir.
  - `job run <name> [--max N]`: assert-or-checkout `job/<name>`, wake
    the chain's entry phase (`phases[0]`) only from hibernation, then
    run the standard loop under the job resolution.
  - `job rm <name>`: refuse while `loop.pid` records a live pid;
    remove the harness dir with a cleanup commit and sweep untracked
    runtime remnants. The job branch and its history survive.
  - `job status`: enumerate `.flume/jobs/*` — awake phases + pending
    count per job, read-only.
  - `job extract <name> --onto <base> [--intake <path>]...`: the
    clean-history ending — intake pass-through ships first, then the
    non-harness commits in `<base>..job/<name>` cherry-pick
    oldest-first onto the new branch; a conflict unwinds completely
    (job intact, extract retryable); `friction.md` + open questions are
    harvested to stdout; the job branch and harness dir are consumed.
    Refuses to clobber an existing branch or run while another worktree
    holds `job/<name>`.
- `--job <name>` global flag / `FLUME_JOB` env: resolves
  `FLUME_DIR` = `FLUME_CONFIG_DIR` = `<repoRoot>/.flume/jobs/<name>`
  and writes all three back into env, so loop-spawned tick children
  inherit the resolution. Explicit `FLUME_DIR`/`FLUME_CONFIG_DIR`
  alongside `--job` is a usage error (exit 2). Wrong-branch guard:
  under a job resolution, `tick`/`loop` refuse unless
  `HEAD == job/<name>`; read-only subcommands skip the check.
- Job-namespaced fanout: with `FLUME_JOB` set, worktree branches become
  `flume/<job>/<slug>` and worktree paths gain the matching namespace
  segment, so two jobs sharing a tag slug no longer clobber each
  other's branches or checkouts. Without `FLUME_JOB`, legacy names
  stand — bare `.flume` harnesses are unchanged.
- The v0.4 surface, previously uncut:
  - Orphaned awake flags (no matching chain phase) are a typed Axis-C
    terminal misconfiguration: exit code 78, loop fail-fast instead of
    silent idling.
  - `Phase.agent` — per-phase agent resolution, overriding the
    dispatcher-level default for that phase's ticks.
  - Entry-scoped fanout write guard: a fanout tick may write only its
    entry's declared files ∪ the phase's `entryChannelPaths`
    (cross-entry channel files, e.g. shared plan notes).
  - windows-latest CI lane, locking in the 0.3.1 win32 portability
    end to end.
  - PR #5 reconciliation closed out: docs + regression tests for the
    surface folded into source at 0.3.1 (`FLUME_WORKTREES_DIR`, the
    loop lock, `observedFiles`, `revertedTags`, wave auto-unblock).

### Fixed

- A relocated state root (`pendingPath` outside `repoRoot`) no longer
  produces a bookkeeping chore commit in the target repo.

## [0.3.1] - 2026-07-22

Reconciliation and portability. Folds the temper-side runtime hand-patches
(PR #5, forked at 0.2.0) into source so consumers stop re-patching
`node_modules` after every install, and makes win32 a working host end to
end — spawns, session capture, and the full test suite.

### Added

- `FLUME_WORKTREES_DIR`: relocate fanout worktrees outside every repo-path
  prefix (stray-write vector). Default remains `<flumeDir>/worktrees`.
- Cross-process loop lock: `flume loop` writes `<flumeDir>/loop.pid`;
  a second supervisor against the same state root is refused while the
  recorded pid is alive; stale pidfiles are reclaimed.
- `PendingEntry.observedFiles`: a reverted attempt's actual commit
  footprint persists on the entry and joins the next partition, so a retry
  never rides with what it collided with.
- `TickResult.revertedTags`: merge-thrash vs in-session retry is
  telemetry-visible.
- Ship bookkeeping auto-opens `blockedBy` gates whose blocker shipped in
  the same wave.

### Fixed

- A no-op footprint update no longer reports the pre-existing HEAD as its
  commit.
- win32: package-manager `.cmd` shims spawn through a direct-spawn →
  ENOENT → shell-retry fallback in `shellGate` and the claude invocation
  (Node CVE-2024-27980 hardening refuses bare `.cmd` spawns).
- win32: `withTerminalRenderer`'s default tag and session-capture
  filenames derive from `basename()`, not `split("/")` — drive-lettered
  cwds no longer produce invalid filenames or full-path tags.
- win32: test suite is fully green — portable slug parsing in fanout
  fixtures, `core.autocrlf false` pinned in temp repos, platform-absolute
  path fixtures.

## [0.3.0] - 2026-06-22

A foundations governor for the build phase, plus a relocatable state dir for
self-contained, ephemeral runs.

The governor: the dispatcher no longer treats `gate: open` as "foundations
settled" — an entry can declare the open-question forks its work rests on, and
is skipped while any remains unresolved. Closes the build-laterally failure mode
where the loop accreted surfaces on product/UX decisions it had itself flagged
as open. Relocation: all mutable state (baton, pending, worktrees,
prior-attempts) moves under one configurable `flumeDir`, so a harness can
attach, run, and be torn down in a single `rm`. See `spec/RELEASE-v0.3.md`.

### Breaking

- `Baton` now constructs from the flume **state dir**, not the repo root:
  `new Baton(flumeDir)` (was `new Baton(repoRoot)`, which appended
  `.flume/awake` internally). For the prior location pass
  `join(repoRoot, ".flume")`. All in-tree callers (`Dispatcher`, `cli`) are
  updated; the `.flume` default now lives one layer up (Dispatcher/CLI).

### Added

- Relocatable state dir (`flumeDir`): `DispatcherOptions.flumeDir?` (default
  `<repoRoot>/.flume`) moves the baton (`awake/`), pending
  (`plan/pending.json`), worktrees (`worktrees/`), and prior-attempt records
  (`prior-attempts/`) under one configurable root — so a fully self-contained,
  ephemeral harness can attach, run, and be torn down in a single `rm` without
  state bleeding into `<repoRoot>/.flume`. Independent of `configDir`; set both
  to the same dir to co-locate config and state. The CLI reads `FLUME_DIR`
  (state) and `FLUME_CONFIG_DIR` (chain + prompts) and carries them across the
  `loop`→`tick` process boundary via env inheritance.
- **`GateContext.flumeDir` / `TickContext.flumeDir` + reserved `{{FLUME_DIR}}`
  prompt arg** — gates and prompts receive the resolved state root injected, so
  a chain references state-relative paths without hardcoding `.flume/` or
  reaching into `process.env`. `{{FLUME_DIR}}` is auto-injected into every
  prompt's substitution map (a chain-supplied arg cannot shadow it);
  `writablePaths` stays `process.env.FLUME_DIR`-derived (static, chain-load time).
- **`PendingEntry.dependsOnForks: string[]`** — open-question fork slugs an
  entry's foundation rests on. Optional, defaults to `[]`; additive and
  non-breaking. Rendered into the plan prompt schema so plan emits it.
- **`DispatcherOptions.forkResolver?: (repoRoot) => (slug) => boolean`** — the
  injected resolution seam. Consulted once per tick; an entry with any
  unresolved declared fork is not pickable. Defaults to always-resolved, so a
  chain that supplies no resolver is behaviourally identical to 0.2. The
  runtime stays format-agnostic — how a project records and resolves forks
  lives in the resolver, not the harness.
- **`ChainModule.forkResolver?`** — a `.flume/chain.ts` may export a
  `forkResolver`; the dispatcher resolves `chainModule.forkResolver ??
opts.forkResolver` per tick, exactly as `agent` overrides the default. This
  is the adoption path for stock-CLI consumers (which never touch
  `DispatcherOptions`): export the resolver from chain.ts and the governor
  picks it up.
- **`isPickableNow(entry, shippedTags, isForkResolved?)`** — gains a trailing
  optional fork-resolution predicate (defaults to always-resolved). The
  foundations check precedes every gate kind. Skip-to-settled and
  idle-rather-than-build-laterally fall out of the existing fanout filter; a
  fork-blocked entry is never failed or reverted.
- `docs/CHAIN-AUTHORING.md` — resolver-authoring guidance, including the
  fail-open rationale (absent/unknown slug ⇒ resolved) and a worked example.

### Fixed

- Session logs leaked outside a relocated dock when `FLUME_DIR` was unset or
  relative: the CLI now canonicalizes the resolved `flumeDir` / `configDir` back
  into `process.env.FLUME_DIR` / `process.env.FLUME_CONFIG_DIR` as **absolute**
  paths, so a chain loaded later in the same process (and any spawned child)
  reads one authoritative state root. The dogfood chain's `?? CHAIN_DIR`
  session-dir fallback is now defensive only — `FLUME_DIR` is always set to the
  resolved root, keeping the whole footprint under one `rm`.
- `flume render` resolved prompt files from `<repoRoot>/.flume` instead of the
  configured `configDir`; it now honors `configDir` (and `FLUME_CONFIG_DIR`).

## [0.2.0] - 2026-05-17

Dispatcher correctness for long-running and autonomous loops: the harness
is now safe to leave running unattended — fanning out, retrying, and
rewriting its own chain — without corrupting its state, silently
discarding work, or looping blind.

### Breaking

- `DispatcherOptions` no longer accepts a constructed `chain`. The
  dispatcher resolves `.flume/chain.ts` from `configDir` itself, once per
  tick, in its own process. A `chainLoader?: () => Promise<ChainModule>`
  option is added for in-process test injection only and defaults to the
  disk resolver. Construct `Dispatcher` with `configDir` and drop the
  `chain` argument.

### Added

- `chainLoadGate` — a builtin gate (joining `shellGate`, `tscGate`,
  `vitestGate`, `eslintGate`, `writablePathsGate`). Declared on phases
  that can write `.flume/chain.ts`, it validates that the post-tick file
  loads and default-exports a valid `Chain`; a broken rewrite fails the
  gate and the revert path restores the last-good `chain.ts`.
- Per-tick chain re-resolution: `.flume/chain.ts` is read fresh at the
  start of every tick, so a tick that commits a rewritten chain (new
  phases, handoff, gates, writablePaths) is governed by it on the next
  tick.
- Prior-outcome context for retries: when a prior tick produced no usable
  commit, the next tick's rendered prompt carries a mode-tagged block —
  `gate-revert` (failing gate name, full details, and a bounded digest of
  the reverted commit), `voluntary-bail` (the constraint the agent
  refused to cross), or `platform-preempt` (the non-work failure class,
  marked as not a defect in the prior work) — so a retry no longer
  re-derives the same wall blind. The block is empty on a first attempt.
- No-commit outcome taxonomy on `TickOutcome`: a no-commit tick is
  classified as exactly one of `gate-revert`, `voluntary-bail`, or
  `platform-preempt`, distinguishable in the trajectory/logger record
  without reading session logs.

### Fixed

- Worktree create/teardown race: every `.git/worktrees/`-mutating git
  operation (create, remove, prune) is now serialized, so a sibling
  task's stale-slug cleanup can no longer fail a concurrent
  `git worktree add` mid-wave. Per-entry agent invocations stay parallel.
- `afterMerge` wave-revert blast-radius: an `afterMerge` gate failure now
  reverts only the offending entry's commit and leaves it pending; its
  clean siblings in the same fanout wave stay shipped instead of being
  reset with it.
- Silent plan-prose loss on revert: a gate-reverted plan tick's prose
  (`state.md`, `open-questions.md`) is now recoverable without reading
  session logs.

### Changed

- `flume loop` is now a supervisor that spawns one `flume tick` process
  per iteration (process-per-tick) — the boundary that makes per-tick
  chain re-resolution real. Observable `--max` and hibernation behavior
  is unchanged.

## [0.1.1] - 2026-05-15

Interim npm release, published out-of-band from a fork branch. The annotated
tag `v0.1.1` exists but points at the off-`main` fork commit `ce73d95`; its
content — the README/docs scope fixes below — was reconciled into canonical
history on `main` as `e9adb1c`. (`v0.1.0` (`8d6ea2c`) is likewise tagged
off-`main`; `v0.1.2` onward is tagged on canonical history.)

### Fixed

- README quickstart and `docs/CHAIN-AUTHORING.md` referenced the
  placeholder `@<scope>/flume` / unscoped `flume`; corrected to the
  published `@dtmd/flume`.

## [0.1.2] - 2026-05-16

### Added

- `Phase.teardownWorktree?(ctx)` — best-effort per-worktree resource
  release (per-tag DB, scratch lease, short-lived credential), invoked
  between agent exit and worktree removal; failures log and do not block
  removal.
- `setupWorktree` may return `{ extraEnv }` (new `WorktreeSetupResult`
  export); the dispatcher layers it onto the agent invocation env.
  `void`-returning implementations are unaffected — backward compatible.

## [0.1.0] - 2026-05-15

First public release. Published to npm as `@dtmd/flume` (the unscoped
`flume` is an unrelated package). ESM-only, Node 22+.

### Added

- Core harness contracts: `Phase`, `Chain`, `Gate`, and the pending-entry
  schema (`PendingEntry`/`PendingList`, `parsePending`,
  `renderSchemaForPrompt`, `touchedPaths`, `isPickableNow`).
- `Dispatcher` runtime: stateless ticks, singleton + git-worktree fanout
  concurrency, afterCommit/afterMerge gates, writable-paths enforcement,
  cherry-pick merge with stale-worktree pruning.
- `Baton` filesystem-flag phase signalling.
- Agent seam: `claudeCode` provider with `timeoutMs` + `outputFormat`,
  composable `withSessionCapture` and `withTerminalRenderer` decorators.
- Built-in gates: `shellGate`, `tscGate`, `vitestGate`, `eslintGate`,
  `writablePathsGate`.
- `renderPrompt` template renderer (substitution + inline-exec).
- CLI `flume`: `status`, `tick`, `loop`, `wake`, `sleep`, `render`, with
  `--help` per subcommand and `--version`.
- Distribution: compiled `dist/` (`.js` + `.d.ts`), strict single-entry
  `exports` map, `tsImport`-based consumer chain loading.
- CI publish-acceptance gates: `attw --profile esm-only`,
  consumer-install smoke, `npm pack` file-set guard.
- Documentation: `README.md`, `docs/CLI.md`, `docs/CHAIN-AUTHORING.md`,
  `docs/INTENT.md`; `examples/cascade-chain.ts` and
  `examples/minimal-chain.ts`.
- MIT license.
