# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0: minor versions may introduce breaking changes to the public API surface
(see `spec/RELEASE-v0.1.md` §2). Breaking changes land under a `### Breaking`
subheading per `spec/RELEASE-v0.1.md` §9.

## [Unreleased]

### Breaking

- An inline-exec span that fails to resolve (non-zero exit, spawn failure,
  `sh` not found, output-cap overrun) now **aborts the prompt render** —
  the agent is never invoked, and the tick classifies as a no-commit
  `render-refused` outcome distinct from a voluntary bail (v0.10 §3). The
  `<exec-failed cmd="...">stderr</exec-failed>` substitution is deleted: a
  chain that relied on a tolerated failing span silently sending anyway
  will now fail its tick loudly instead. The error names every failing
  span's command text and stderr.

### Fixed

- Inline-exec (`` !`cmd` ``) spans now reach `sh` through stdin instead of
  argv (`["-c", cmd]`), fixing corruption of any non-ASCII byte anywhere in
  the command on win32 — measured under MSYS2 `sh.exe`: quoting was not
  implicated, `é` corrupted as readily as `—`, and neither
  `windowsVerbatimArguments` nor `shell: true` surfaced the failure (both
  exited 0 with empty stdout). `spawn` has no `maxBuffer`, so the existing
  4 MiB output cap is now enforced by hand (v0.10 §2). Declared consequence:
  `sh` now consumes stdin, so a span whose command itself reads stdin sees
  EOF instead of inherited input — no span in this repo's prompts or either
  example chain does.
- `Prompt.ts` no longer shares `execGate`'s win32 `.cmd`-shim shell-retry
  fallback for inline-exec spans: that fallback is correct for
  package-manager binaries, wrong for `sh -c` payloads written in a
  language cmd.exe doesn't speak (v0.10 §4). `execGate` drops its export —
  `shellGate` is its sole caller now.

## [0.9.0] - 2026-07-31

The doctrine line: one engine per bay, resolved by the package manager
(`pnpm exec flume` / npm scripts). Flume ships no version-coordination
machinery — the 0.8.0 engine↔pin handshake and the job-dir engine link
are removed outright (net −675 lines). Global installs are unsupported.
Also carries the 0.8.0 migration-wave fixes below; 0.8.1 was never cut.

### Breaking

- The engine↔pin handshake (v0.7 §10, shipped 0.8.0) and job-dir engine
  link provisioning (v0.5 §5a step 4, shipped 0.5.0) are removed (v0.9
  §§1-3, "the doctrine line"). Invocation is exec-local: a bay declares
  `@dtmd/flume` as its own dependency and invokes it via the package
  manager (`pnpm exec flume`, an npm script, `npx`) — the binary that
  runs is the bay's pinned copy, and the chain's `import "@dtmd/flume"`
  resolves that same copy natively, no version-coordination machinery
  required. A stray global engine on PATH is unsupported and undetected;
  a version mismatch against a bay's pin fails however it fails.

### Removed

- `engineHandshake` and its apparatus — `readLocalInstall` (including
  the `"self"` outcome), `readPin`, `OWN_PACKAGE_ROOT`, the three arms,
  the re-exec — and the job-run-form/`--max` validation legs that
  existed only to feed it (v0.9 §2).
- `ensureFlumeLink`; `flume job new` no longer plants a job dir's
  `node_modules/@dtmd/flume` link (v0.9 §3). Existing job dirs' links go
  inert (Node resolution finds them first if present, harmlessly
  pointing at whichever engine once ran there) — delete them at leisure;
  no sweeper or migration ships.

### Fixed

- The engine↔pin handshake's self-referential local-install check (v0.7 §10
  amendment) now returns a distinct `"self"` outcome and proceeds as
  authority, instead of collapsing a provisioned install that real-path-
  resolves back to the running engine itself (e.g. this repo's own dogfood
  chain provisioning a job from a source checkout) into "absent" and
  routing a pinned bay through arm 2's refusal — no pinned,
  self-referentially-provisioned bay could previously run at all.

### Added

- `pendingGate`'s (v0.8 §6) `fenceWhen?: (entry: PendingEntry) => boolean` —
  a predicate selecting which entries the build-fence pre-check applies to,
  so a chain carrying park-exempt `gate.kind` values (e.g. `"parked"`,
  `"deferred"`) can exempt those entries without hand-rolling a fork of the
  gate. Default `() => true` fences every entry, matching prior behavior
  exactly.

## [0.8.0] - 2026-07-30

Two lines cut together (0.7.0 was never published): **v0.7 "the truth
line"** — the engine never misstates what it will do or did — and
**v0.8 "the boundary line"** — the engine ships mechanism, never
convention. Upgrading an existing chain: read
[`docs/MIGRATING-0.8.md`](docs/MIGRATING-0.8.md) **before** bumping the
pin — the schema split is breaking-first.

### Breaking

- The pending-entry schema splits into an engine core and a chain-declared
  extension (v0.8 §2). The core keeps only what the engine mechanically
  consumes — `tag`, `files`, `gate`, `dependsOnForks`, `observedFiles` —
  and is strict: fields neither core nor declared by the chain fail
  validation. `summary`, `per`, `tests`, `acceptance`, `notes`, and
  `schemaDelta` are no longer engine fields; chains that want them declare
  them via `Chain.entryExtension`, each field carrying its zod schema and
  its prompt hint in one declaration, from which the engine composes both
  the validator (`parsePending(raw, extension)`) and the rendered prompt
  schema (`renderSchemaForPrompt(extension)`) — no drift possible.
  `PendingEntry`/`PendingList` are now type-only exports;
  `composePendingList` and `parsePendingLoose` (core-only, passthrough, for
  chain-less informational reads) are new.

### Changed

- `tag`'s grammar reduces to mechanical safety only (v0.8 §3): the engine
  requires a conservative charset (letters, digits, `._()-`), no
  whitespace, and a length bound derived from the tightest place the
  engine writes a raw tag into a filename — no longer the ALL-CAPS/dash
  convention the engine used to enforce. `DAL-REWIRE(usp_Filter_Get)` now
  validates against the bare core. A chain wanting stricter grammar
  declares a `tag` refinement via `Chain.entryExtension` — the one core
  field name the extension may declare — which composes as an
  intersection with the engine's mechanical floor, never a replacement of
  it; `renderSchemaForPrompt` states whichever constraint is actually in
  force. `composePendingList`'s array schema now also rejects a duplicate
  `tag` within the queue, naming every offending index — mechanical
  safety, since the engine's own lookups (cli find-by-tag, Dispatcher
  `blockedBy`/`shippedTags`) key on tag identity and a duplicate would
  silently resolve to the wrong entry. `parsePendingLoose` stays
  passthrough; nothing on that read-only path keys by tag.
- The gate kind `requiresDockerHost` generalizes to
  `requiresCapability(capability)` (v0.8 §4): a pending entry names any
  environment fact it needs (`gate: { kind: "requiresCapability", capability:
  "docker-host" }`), and the chain declaration gains an optional
  `capabilities?: string[]` — the facts it asserts, since `chain.ts` is
  TypeScript and may probe the environment at load time. An entry gated on
  an unasserted capability is skipped, never silently: `flume status` names
  the missing capability alongside the entry's tag.
- `flume loop`'s supervisor policy (v0.7 §16: run-scoped provisioning-
  failure quarantine, three-consecutive-identical-failure abort threshold)
  becomes chain-overridable (v0.8 §8): the chain declaration gains an
  optional `supervisorPolicy?: { quarantineScope?: "run" | "none";
  abortThreshold?: number }`. `quarantineScope: "none"` disables per-entry
  quarantine outright (the abort backstop still applies); `abortThreshold`
  sets how many consecutive identical-signature failures trip it. A chain
  declaring neither field gets the v0.7 §16 defaults, byte-identical.
- Every tick that runs a phase now writes one unified verdict — phase,
  entry tag(s), committed/no-commit class, gate results (including any
  captured `details`, e.g. a writable-paths gate's violating paths),
  shipped tags, and each fanout entry's cherry-pick/merge outcome (v0.8
  §5) — superseding the v0.7 §4-amendment `last-tick.json` counts file.
  `flume loop`'s supervisor reads the same artifact for its exit-code/count
  contract (unchanged behavior, now sourced from the unified verdict) and
  derives "errored" from the facts at the read site rather than a stored
  field — the artifact itself carries no interpretation, only what
  happened. A new `readTickVerdicts` accessor exposes the last N verdicts
  so a chain can render recent tick history into a prompt.
- Fanout footprint commits (v0.7 §13: the actual touched paths of a
  merge-failed or gate-reverted attempt, recorded onto the entry's
  `observedFiles`) now source their content from the same per-entry
  `mergeOutcomes` records the tick's verdict carries, instead of a second,
  independently-maintained observed-files map — one capture, not two.

### Added

- `GateContext.repoRoot` — the absolute path of the working-tree root a
  gate is running in (worktree root under fanout, primary checkout under
  a bare tick), so gates stop reinventing the `git rev-parse
  --show-toplevel` + fallback helper themselves.
- The mount-dead failure class (chain module cannot load, state root
  missing, declaration invalid) now gets its own exit code, `EX_MOUNT_DEAD`
  (69), sibling to the existing terminal-misconfiguration code (78) rather
  than the generic `1`. `flume loop` aborts the run on a child's first
  mount-dead tick instead of burning every remaining `--max` tick
  re-hitting the same wall — an unloadable chain now surfaces non-zero to
  CI after one tick's worth of work instead of silently exiting 0 at
  `--max`.
- `flume loop` / `job run` now exit non-zero iff at least one tick errored
  AND zero entries shipped this run — an empty-queue settle and a partial
  success (ships landed despite some tick errors) both still exit 0, but
  the completion summary now names every surfaced tick error so a partial
  success no longer vanishes into a silent green exit. Each child `flume
  tick` writes its shipped/errored counts to a small on-disk artifact the
  supervisor reads between iterations — child stdio stays `inherit`.
- `repoRoot` now walks up from `cwd` looking for the nearest `.flume`,
  mirroring git's `.git` resolution, instead of taking `cwd` itself
  literally. Running any subcommand from a subdirectory below the bay, or
  from inside `.flume` itself (`cd .flume && pnpm flume job status` — the
  operator's own habit), now resolves the same bay as running from the
  repo root instead of silently looking at the wrong (or a nonexistent)
  `.flume`. A tree with no `.flume` anywhere above `cwd` keeps `cwd` as
  `repoRoot`, unchanged, so a first `flume job new` in a fresh, undocked
  repo still creates `.flume` at `cwd`.
- The engine now defers to a bay's local install: before any subcommand
  dispatch, a running `flume` checks `<repoRoot>/.flume/node_modules/@dtmd/flume`
  and, when it resolves, re-execs it with the same argv and inherited
  stdio — silent, version-proof by construction, no comparison against the
  invoked engine's own version. When the bay's own `package.json` pins
  `@dtmd/flume` but no local install resolves, `flume` refuses loudly
  (exit 2) naming the pin and both versions instead of silently running a
  possibly-mismatched engine. An unpinned bay runs the invoked engine
  unchanged.
- `setupWorktree` — a lockfile-aware fanout worktree provisioning helper,
  re-exported from `flume`'s top level alongside `builtinGates`: a
  `pnpm-lock.yaml` runs `pnpm install --frozen-lockfile`, a
  `package-lock.json` runs `npm ci`, and a directory with neither refuses
  cleanly instead of guessing a package manager. Each consuming chain
  previously hand-rolled a single-package-manager hardcode for this; the
  worked example in `docs/CHAIN-AUTHORING.md` now shows the helper as the
  recommended default.
- `pendingGate` (v0.8 §6) — an opt-in builtin gate composing the pending
  list's core+extension schema validation (§2) with a plan-time fence
  pre-check: every entry's declared `files` must survive the target
  phase's `writablePaths ∪ entryChannelPaths`, or the gate fails naming
  the offending paths at commit time of whichever phase produced the
  queue — instead of the entry shipping through to a build tick that is
  guaranteed to revert on the writable-paths gate.
- Second reference chain (v0.8 §7): `examples/backlog-groomer-chain.ts`, a
  single-phase chain (no spec corpus, no plan/build split) that reads a
  `BACKLOG.json`, ships the top pickable item, and commits — its own small
  `entryExtension` and a lowercase-kebab `tag` refinement, exercising §§2-4
  on the unpatched engine from a second angle. `docs/CHAIN-AUTHORING.md`
  presents it alongside `cascade-chain.ts` as a peer, not a variant.

### Fixed

- A fanout wave's ship commit (`commitPendingUpdate`) now derives its
  `pending.json` rewrite from a fresh disk read taken immediately before
  writing, instead of the snapshot the dispatcher read at tick start.
  Fanout waves provision worktrees and run agents before shipping, a
  window long enough for another process's write to trunk's
  `pending.json` to land in the meantime; rewriting from the stale
  tick-start snapshot silently overwrote that write — observed as a ship
  commit reintroducing a retired field into entries the wave never
  touched. The rewrite now only ever removes the tags it shipped and
  touches `observedFiles`/`blockedBy` for tags it knows about, leaving
  every other entry exactly as it stood on disk at write time.
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
- A CJS-context host (its `package.json`, or one beside `.flume/chain.ts`,
  lacks `"type": "module"`) now refuses chain load with a usage-shaped
  message naming the fix and exits 2, instead of relaying tsx's raw
  loader stack. A genuinely missing dependency still surfaces as itself.
- An in-worktree `afterCommit` gate revert on a fanout tick now leaves the
  same per-entry trunk footprint an `afterMerge` failure does — the
  reverted commit's touched paths land in `pending.json`'s `observedFiles`
  via the existing footprint-commit mechanism, instead of only the
  gitignored prior-attempt record. The next plan tick's inputs now carry
  the violating paths instead of an empty delta.
- `TickResult` now carries the RELEASE-v0.2 §6 no-commit classification
  (`noCommit?: "gate-revert" | "voluntary-bail" | "platform-preempt"`),
  present iff the tick produced no usable commit. `Dispatcher.tick`
  previously computed this classification and discarded it before calling
  `phase.handoff(result)`, so no chain's `handoff` could ever distinguish
  a voluntary bail from a genuine nothing-pickable no-op.
- The engine↔pin handshake's local-install check (v0.7 §10) now derives its
  check path from `resolveStateDirs`'s `flumeDir` instead of a fixed
  bay-root literal: a `--job`/`FLUME_JOB`-scoped invocation checks
  `<repoRoot>/.flume/jobs/<name>/node_modules/@dtmd/flume` — the link
  `job new`'s `ensureFlumeLink` actually provisions — instead of a
  bare-bay path a job-scoped bay never populates. A bare bay's check is
  unchanged. The handshake's job-scope peek now also recognizes the
  `flume job run <name>` invocation form (previously only `--job`/
  `FLUME_JOB`), so a job-run-driven bay checks the same job-scoped install
  path instead of the bare-bay one.
- The handshake's `job run <name>` peek now validates a `--max` flag's
  value (present, not dash-prefixed) before splicing it out, mirroring the
  real `job run` rewrite's own check. Previously a malformed `--max` (e.g.
  `job run --max -3 alpha`) still spliced cleanly and let the handshake
  resolve `<name>`'s job-scoped install path, even though the real
  dispatch would go on to reject the same invocation with its own usage
  error — a well-formed-looking peek papering over a shape the real
  command never accepts.
- `flume status` now probes the top-level `loop.pid` for process liveness
  beside the awake markers: a live supervisor is named by pid, a stale
  pidfile (recorded pid no longer running) is reported as such, and no
  pidfile prints unchanged from before. Previously `status` read baton
  markers only, so a live supervisor between waves read identically to no
  supervisor at all — the gap behind the 2026-07-29 incident where an
  operator relaunched over a still-live supervisor after misreading
  "hibernating".
- `git.dropLastCommit` now takes the sha the caller itself just committed
  and refuses — naming both the current tip and the expected sha, leaving
  the tip in place — if the current tip has moved on since. Previously it
  blindly hard-reset whatever commit happened to be at `HEAD~1`, so a
  stale supervisor sharing a tree with a live one could drop a commit it
  never created.
- A pre-tick worktree provisioning failure (sweep or create) on one entry's
  slug no longer crashes the whole fanout wave: the entry stays pending and
  the `flume loop` supervisor quarantines its slug for the rest of the run
  while the other pickable entries keep dispatching, same tick included.
  Any failure signature (entry-scoped or repo-level) that repeats three
  consecutive ticks with no successful tick between them now aborts the
  run non-zero naming the signature, instead of burning every remaining
  `--max` tick re-hitting the same wall — the `ship-detection-declared-
  files-diff` incident (12 of 16 ticks lost to one held worktree dir) does
  not reproduce.

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
