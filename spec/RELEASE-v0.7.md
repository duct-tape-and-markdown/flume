# Flume — v0.7 Release Target (minor: the truth line)

## 1. Purpose & scope

One theme: **the engine never misstates what it will do or what it did** —
to an agent, to an operator, or to CI. Four field findings from 2026-07-27/28
share that failure shape, and this line closes the class, not the sightings:

- Agents on entry-scoped fanout ticks are shown the *unnarrowed* phase fence
  in the `<harness>` block while the write guard enforces a strict subset —
  every dev-9175-cim-usage fence casualty traces here, and both
  centercode-platform (PR #672) and temper had to hand-write fence clarity
  into chain prompts that the engine should self-transmit.
- `dist/cli.js` reached through a Windows directory junction silently exits
  0 having run nothing (observed live, DEV-9191 delivery).
- A chain that cannot load burns every tick in a `--max` run and still
  exits 0 — silent CI green on a dead chain.
- A CJS-context host repo fails chain load with a raw tsx stack instead of
  a usage-shaped refusal (verified against published 0.6.0 — longstanding).

Plus two freebies riding the line: `GateContext.repoRoot` (kills a helper
every gate reinvents) and `prepack` building (a local `npm pack` can today
ship stale `dist/` silently).

Explicitly **not** in this line (operator ruling 2026-07-28): the
structured-verdicts family — engine-side pending.json validation at the
plan gate, plan-time path pre-checks against the next phase's fence, and
persisting revert verdicts where plan reads them. Those entangle
pending.json semantics together and hold for a v0.8 line of their own.
Also declined: *supporting* CJS-context hosts (§5 refuses honestly instead).

Blast radius: `src/` (Prompt, cli entry, Dispatcher/loop exit paths,
GateContext), `tests/`, `docs/CHAIN-AUTHORING.md` (§5 worked example),
`package.json` scripts, CHANGELOG. No chain or prompt content ships from
this line.

## 2. Harness block states the effective fence

On a tick carrying an `assignedEntry`, `prependHarnessBlock`
(`src/Prompt.ts:218`) today renders `phase.writablePaths` under "anything
else you modify will revert the commit" — but the write guard
(`src/Dispatcher.ts:1056-1068`, per `spec/RELEASE-v0.4.md` §5) narrows the
revert boundary to `entry.files ∪ phase.entryChannelPaths`, a strict
subset. The engine's one authoritative prompt surface misstates its own
enforcement exactly where it is narrowest.

- Scoped ticks: the harness block states the **effective** fence — the
  union of `entry.files` and `phase.entryChannelPaths` as "your commit may
  touch exactly these; anything else reverts the commit whole" — and names
  `phase.writablePaths` separately as the outer ceiling (both checks are
  real and independent; a path must clear both).
- Unscoped ticks: rendering unchanged, byte-identical to today.
- The `<prior-attempt>` retry feedback mandated by v0.4 §5 (name the
  offending path after a revert) is unchanged — the reactive detail stays;
  this section only makes the *pre-commit* statement truthful.
- `docs/CHAIN-AUTHORING.md` §5's worked example currently teaches the
  collapsed rendering as correct; it is rewritten in the same entry to
  show the narrowed block.

Acceptance: a scoped tick's rendered prompt names exactly the fence the
guard will enforce; an unscoped tick's prompt is byte-identical to 0.6.2.

## 3. CLI entry survives junctions

`src/cli.ts:806-808` decides "invoked directly" by comparing
`import.meta.url` (which resolves through a junction to the file's
realpath) against `pathToFileURL(process.argv[1])` (which keeps the
junction path verbatim). Through any junction- or symlink-based install
(pnpm's linked store, the v0.5 §4 provisioning shape) the two never match,
`main()` never runs, and the process exits 0 having done nothing.

- Compare realpaths: resolve `process.argv[1]` via `fs.realpathSync`
  before the comparison. Guards: `argv[1]` undefined → not direct
  (unchanged); `realpathSync` throws → fall back to today's raw
  comparison, never crash the import.
- Importing the module without executing it (tests, embedding) must still
  not run `main()`.

Acceptance: `dist/cli.js` reached through a directory junction executes
the requested command (the DEV-9191 silent no-op does not reproduce); a
plain module import runs nothing.

## 4. Exit-code contract — the run never lies to CI

Ruled contract (operator, 2026-07-28):

- **Mount-dead aborts immediately.** A failure in the load/mount class —
  chain module cannot load, state root missing, declaration invalid —
  aborts the run on first occurrence with a usage-shaped error and a
  non-zero exit. It does not burn the remaining `--max` ticks re-hitting
  the same wall.
- **`loop` / `job run` exit non-zero iff at least one tick errored AND
  zero entries shipped.** "Settled with nothing to do" (empty queue, plan
  declines to continue) stays 0. Partial success — ships landed despite
  some tick errors — stays 0, with the errors surfaced in the completion
  summary (they must not vanish into a green exit silently).
- Tick-level agent failures keep today's semantics (fail the tick, the
  run continues); only the mount-dead class halts the run.

Acceptance: a run against an unloadable chain exits non-zero after one
tick's worth of work; an empty-queue run exits 0; a run with one errored
tick and one shipped entry exits 0 and its summary names the error.

## 5. CJS-context host: detect and refuse

A host repo whose own `package.json` lacks `"type": "module"` fails
`.flume/chain.ts` load with a raw loader stack (tsx 4.21:
`Cannot use import statement outside a module`; tsx 4.23: an
`ERR_MODULE_NOT_FOUND` with the `tsImport` `?namespace` query
percent-encoded into the path). Supporting that context is declined;
lying about it with a stack trace is the defect.

- When chain load fails with the module-context signature family, the
  engine refuses with a usage-shaped message: the host must carry
  `"type": "module"` (in the repo's `package.json` or a `package.json`
  beside the chain), stated as the fix. Exit 2, consistent with other
  usage errors. The underlying loader error remains available (debug/
  verbose detail), not the headline.
- Build determines the reliable detection signature empirically (the two
  fixtures above are the known family); false positives on genuine
  module-resolution failures must not occur — when unsure, show the raw
  error as today.

Acceptance: chain load in a CJS-context fixture (the `npm init -y` smoke
shape, pre-fix) prints the usage-shaped refusal naming `"type": "module"`
and exits 2; a genuinely missing dependency still surfaces as itself.

## 6. `GateContext.repoRoot`

New field on `GateContext`: the absolute path of the working-tree root
the gate is running in — in a fanout tick, the worktree root; in a bare
tick, the primary checkout. The value the `git rev-parse --show-toplevel`
+ fallback helper every gate currently reinvents. No other behavior
changes.

Acceptance: a gate running in a fanout worktree receives that worktree's
root; existing gates keep passing untouched.

## 7. `prepack` builds

`npm pack` runs no build today (only `prepublishOnly` exists), so a local
pack — including `pnpm smoke:install` — packs whatever `dist/` is on
disk; a stale-dist run tests the wrong code silently. Add
`"prepack": "pnpm build"`. CI is unaffected (it builds explicitly).

Acceptance: `pnpm smoke:install` from a dirty `dist/` state exercises the
current source.

## 9. Bay discovery walk-up

`src/cli.ts:514` sets `repoRoot = process.cwd()` literally — no walk-up.
Every state-dir resolution (`resolveStateDirs`, `src/cli.ts:99-122`) and
every `job` verb builds its paths from that single value. Run `flume`
from any subdirectory below the bay, or from inside `.flume` itself —
`cd .flume && pnpm flume job run ...`, the operator's own habit — and
`repoRoot` resolves to the wrong root: `flumeDir`/`configDir` point at a
`.flume` that doesn't exist (or a nested one), and every subcommand
behaves as though the bay were empty. `flume job status` is the sharpest
case: it prints `no jobs` (`src/cli.ts:372-374`) with no error — a
correct-looking answer that is actually a lie about where it looked. Git
resolves `.git/` by walking up from cwd; the CLI has no equivalent for
`.flume/`.

- Replace the literal assignment at `src/cli.ts:514` with a walk-up
  resolver: starting from cwd, at each level check for a `.flume`
  subdirectory; the first level that has one is `repoRoot`. `cwd` itself
  counts as inside the bay — if cwd's basename is `.flume`, `repoRoot` is
  `dirname(cwd)` directly, no further walk needed.
- No `.flume` found anywhere up to the filesystem root: fall back to
  today's behavior (`repoRoot = cwd`) unchanged — a first `flume job new`
  in a fresh, undocked repo must still create `.flume` at cwd, not fail
  or reach for an unrelated ancestor.
- `FLUME_DIR` / `FLUME_CONFIG_DIR`, when set, continue to override
  outright, exactly as today — the walk-up only changes what `repoRoot`
  defaults to; nothing else in `resolveStateDirs` changes.
- Composes with §3 (junction-safe CLI entry) without overlap: §3's fix is
  the `invokedDirectly` check at the bottom of `src/cli.ts` (whether
  `main()` runs at all); this fix is the `repoRoot` line inside `main()`
  (where it resolves state once running). Different lines, no ordering
  dependency, no shared surface.

Acceptance: `cd .flume && pnpm flume job status` (or any subcommand)
resolves the same bay as running from the repo root — no `no jobs` lie;
a directory tree with no `.flume` anywhere above it keeps today's
cwd-as-root default, so bootstrapping a new bay is unaffected. Non-goal:
disambiguating nested bays (a `.flume` inside a `.flume`-having tree) —
walk-up picks the nearest, same as git; no separate UI for v0.7.

## 10. Engine↔pin handshake via launcher-defers-to-pin (the gradlew pattern)

Two field incidents share this gap: temper's 0.3-shaped chain run under
a 0.6 engine (era skew), and a bay pinned to `@dtmd/flume@0.6.2` with
`0.6.0` actually installed (the stale-install lie). Nothing on the
invocation path today compares versions or looks at
`.flume/node_modules/@dtmd/flume` before deciding which engine code
runs — that path is provisioning machinery only (`job new` links it,
`src/job.ts:129`, `src/cli.ts:269`), read later by the chain-loading
tsx process, never by the CLI's own entrypoint selection. Whatever
binary the operator's shell finds always runs itself, local install or
not, pinned or not.

The global bin becomes a thin launcher, three arms, evaluated in order
at CLI startup, before subcommand dispatch:

1. **Local install exists** — `<bay>/.flume/node_modules/@dtmd/flume`
   resolves (its `package.json` is readable): re-exec that install's CLI
   with the same argv, inheriting stdio; the invoked binary becomes a
   thin pass-through. Silent correctness, no warning — the steady state
   once a bay is provisioned; the engine-version comparison below is
   moot here because the local install *is* the authority, not a copy
   to check against it.
2. **Pinned, local install absent** — the bay's `package.json` declares
   a `@dtmd/flume` version but `.flume/node_modules/@dtmd/flume` doesn't
   resolve (never provisioned by `job new`, or swept): refuse loudly,
   exit 2, usage-shaped, naming the pin and the missing install —
   instead of silently falling through to a possibly-mismatched engine.
   This is the one arm where the running engine's own version
   (`readPackageVersion()`, `src/cli.ts:53-60`) is compared against the
   bay's declared pin at all, and only to make the refusal message name
   both versions — the refusal fires on install-absence, not on the
   version numbers matching or not.
3. **Unpinned** — run the invoked engine as today, unchanged. The only
   arm where current behavior survives verbatim; an unpinned bay is
   choosing to float, and nothing here second-guesses that.

There is no separate warn-only mode: a version mismatch with the local
install present is arm 1's problem to not have (re-exec always runs the
bay's own pinned code, so a mismatch can't reach the agent silently);
a version mismatch with no local install is arm 2's refusal, not a
warning downgraded from a refusal later.

Acceptance: a bay with `.flume/node_modules/@dtmd/flume` present — any
`flume` invocation re-execs the local install (verified via a
version-stamped smoke fixture distinguishing local from global),
regardless of what the global engine's own version is; the same bay
with the local install removed — invocation refuses (exit 2) naming
the pin and both versions, never silently runs a possibly-mismatched
engine; an unpinned bay behaves byte-identical to today. Non-goals:
re-exec across OS-shim differences beyond the existing win32-junction
link machinery `job new` already provisions (reused as the resolution
signal, not redesigned); multi-hop deferral (a local install that
itself defers further) — one hop only.

## 11. `setupWorktree` package-manager-aware helper

Corrected premise: flume's
own engine has no `setupDirs` concept and no `npm ci` hardcode anywhere
in `src/`; `setupWorktree` is an optional chain-authored hook
(`Phase.ts:163-165`), and each consuming chain currently hand-rolls it,
single-package-manager, with no shared helper:

- Flume's own dogfood chain (`.flume/chain.ts:95-103`,
  `buildSetupWorktree`) and the docs' worked example
  (`docs/CHAIN-AUTHORING.md:418-458`) both hardcode
  `pnpm install --frozen-lockfile`.
- connect's chain (`C:\Users\JohnC\connectroot\connect\.flume\chain.ts:484-491`)
  hardcodes `npm ci` per `decl().setupDirs` — a field it declares itself
  (`chain.ts:330-337`, documented at `.flume/README.md:36-58`); this is
  the real site of the pattern the intake doc described as an "engine"
  hardcode. It is chain-authored code in a downstream repo, not
  flume's engine.

Each hardcode is a single package manager, duplicated by hand per repo,
with no shared, lockfile-aware default — the asymmetry the intake doc
named is real, just not where it was first located.

- Flume ships a new exported helper — analogous to the existing
  `builtinGates` precedent (`shellGate`, `tscGate`, … re-exported from
  `src/index.ts:30-37`) rather than a `Gate` itself — that inspects a
  target directory for `pnpm-lock.yaml` → runs
  `pnpm install --frozen-lockfile`; for `package-lock.json` → runs
  `npm ci`; neither present → refuses with a clear message rather than
  guessing.
- `docs/CHAIN-AUTHORING.md`'s `setupWorktree` worked example
  (currently teaching the single hardcoded `pnpm install` command) is
  rewritten in the same entry to show the new helper as the recommended
  default.
- Flume's own dogfood chain (`.flume/chain.ts`) adopts the helper in
  place of `buildSetupWorktree` — dogfood discipline, flume ships flume.

Acceptance: the helper, pointed at a `pnpm-lock.yaml` fixture dir, runs
`pnpm install --frozen-lockfile`; pointed at a `package-lock.json`
fixture dir, runs `npm ci`; pointed at a dir with neither, refuses
cleanly. Non-goals: yarn/bun lockfile support (not evidenced by either
known hardcode site); migrating connect's own chain.ts to call the new
helper — that is connect's own follow-up, dispatched separately, not
part of this entry's blast radius.

## 12. Ship detection requires a declared-files diff

`Dispatcher.ts:1033` classifies any tick that produced a new commit
(`postHead !== preHead`) as `committed`, with no check on *what* the
commit touched. Downstream, a committed entry that cherry-picks onto
trunk and passes its `afterMerge` gates is pushed onto `shipped`
unconditionally (`Dispatcher.ts:849`), which removes it from
`pending.json` via `commitPendingUpdate` (`Dispatcher.ts:870`). A commit
that only writes to a `phase.entryChannelPaths` file — a park note to
`open-questions.md`, no implementation — clears every check on that
path and is classified shipped. `8f11af9`/`35f8f96`/`90208af` is this
exact sequence, live in today's own loop: a park commit, misfiled as a
ship, caught only by a later plan audit rather than by the harness
itself.

- The fanout build commit still cherry-picks onto trunk regardless of
  content — unchanged from today (`Dispatcher.ts:770`). Channel content
  (park notes, prior-attempt context) must still land; this entry gates
  *classification*, not *landing*. A channel-only commit stays on trunk
  exactly as it does today — only whether its entry leaves `pending.json`
  changes.
- Before `shipped.push(r.entry)` (`Dispatcher.ts:849`), diff the
  cherry-picked commit — `git.showNameOnly(repoRoot, mergedSha)`, the
  same helper this function already calls for footprint capture at
  `Dispatcher.ts:776` and `:840` — against the entry's **declared**
  `files.new`/`files.edit`/`files.retire` paths (`PendingSchema.ts:106-110`).
  Not `touchedPaths()` (`PendingSchema.ts:284-291`) — that helper folds
  in `observedFiles`, itself a downstream artifact of prior
  collisions/failures, not a signal that *this* diff shipped real work.
- Predicate direction: **zero overlap → not shipped** — the entry is
  not added to `shipped`/`shippedTags`, stays in `pending.json` exactly
  as it is on disk today (no new write needed for this case — it's the
  absence of a removal). **Any overlap → shipped**, unchanged from
  today, including a real ship that also happens to touch channels or
  `CHANGELOG` alongside its declared files — the predicate only refuses
  the *zero*-declared-files case.
- Log the refusal distinctly so it isn't silent: e.g. `[flume]
  ${entry.tag}: cherry-picked ${mergedSha} touches no declared file —
  entry stays pending (channel-only commit)`, paired with the existing
  `[flume] cherry-picked ${tag} → ${sha}` line so the wave log shows
  landed-but-not-shipped distinctly from landed-and-shipped.
- No new `TickOutcome` variant, no taxonomy growth. RELEASE-v0.2 §6's
  three no-commit modes (`gate-revert`, `voluntary-bail`,
  `platform-preempt`) are untouched and orthogonal — §6 classifies
  ticks that produced **no** usable commit; this entry sits downstream
  of a commit that **did** land, cherry-picked clean, and passed
  `afterMerge` — it is a diff predicate gating `shipped.push`, not a
  fourth no-commit mode. A channel-only commit is not "reverted"
  (`mergeReverted` — that resets trunk) and not any §6 mode either: it
  legitimately lands on trunk, its entry legitimately stays pending.
  Any richer wave-outcome classification (a named bucket for this case,
  structured verdicts more broadly) is v0.8 Theme B territory — this
  entry is pinned to the predicate alone, no new outcome shape.
- Cross-reference: this entry amends `RELEASE-v0.2.md` §6's neighboring
  ship/no-commit vocabulary — §6 owns classifying commit-less ticks;
  this defines what counts as *shipped* once a commit clears cherry-pick
  and `afterMerge`, on the axis §6 doesn't cover. Say so plainly in the
  entry per that spec's own habit of naming what it amends (§1's own
  "adds to / breaks / fixes behavior behind" framing against v0.1).

Acceptance: a channel-only commit (touches only
`phase.entryChannelPaths`, the `8f11af9` shape) cherry-picks onto trunk
but its entry stays in `pending.json` and out of `shippedTags` — the
`35f8f96` misclassification does not reproduce; a normal ship (diff
touches at least one declared file, with or without also touching
channels/`CHANGELOG`) is unaffected — shipped and removed from pending
exactly as today.

## 13. CHANGELOG

- 0.7.0 section: Fixed — harness block states the effective (narrowed)
  fence on entry-scoped ticks; CLI entry runs through directory
  junctions/symlinks; module-context chain-load failure is a usage error,
  not a stack; `pack` can no longer ship stale `dist/`. Added — run
  exit-code contract (mount-dead aborts non-zero; error-and-nothing-
  shipped is non-zero); `GateContext.repoRoot`.
- 0.7.0 section, extend the existing bullets with: Added — bay
  discovery walks up from cwd (`.flume`-resident cwd counts); global
  launcher defers to a bay's local install when present (silent,
  version-proof by construction), refuses loudly when pinned and
  uninstalled, runs the invoked engine unchanged when unpinned;
  `setupWorktree` package-manager-aware helper (pnpm/npm lockfile
  detection) with the dogfood chain migrated onto it.
- 0.7.0 section, add to Fixed: a cherry-picked commit that touches only
  a phase's declared channel paths (a park note, no implementation) no
  longer classifies as shipped — the entry stays in pending.json for a
  real attempt.
- Version bump + `npm publish` stay human-performed at cut time; no phase
  writes the version field.
