# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0: minor versions may introduce breaking changes to the public API surface
(see `spec/RELEASE-v0.1.md` §2). Breaking changes land under a `### Breaking`
subheading per `spec/RELEASE-v0.1.md` §9.

## [Unreleased]

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

## [0.3.0] - 2026-06-21

A foundations governor for the build phase. The dispatcher no longer treats
`gate: open` as "foundations settled" — an entry can now declare the
open-question forks its work rests on, and is skipped while any remains
unresolved. Closes the build-laterally failure mode where the loop accreted
surfaces on product/UX decisions it had itself flagged as open. See
`spec/RELEASE-v0.3.md`.

### Added

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

Interim npm release, published out-of-band from a branch since reconciled
into canonical history. **No `v0.1.1` git tag exists** — its content lives
in canonical history via the README/docs scope fixes below.

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
