# The CLI

This file governs the `flume` binary: the subcommands it offers and what each
owes its caller, how it resolves the state root and config dir from cwd and
environment, how it decides it was invoked as a binary at all, how the package
is built, published, and expected to be invoked, which hosts it supports, and
the versioning promise its public surface carries. Tick semantics, the
supervisor, the locks, and the exit-code contract live in `spec/loop.md`; the
`job` verbs in `spec/jobs.md`; the chain declarations the CLI reads in
`spec/chain.md`.

## Subcommand surface

`flume <command> [options]`. A bare `flume` with no argument is `tick`.

- `status` — observational; prints baton and liveness state, exits 0 always.
  It mutates no baton flag and loads no agent; the one filesystem effect is
  that constructing the baton creates `<flumeDir>/awake/` when absent
  (`Baton`, `src/Baton.ts`).
- `tick` — one phase × one tick of whichever phase is awake.
- `loop [--max N]` — ticks until hibernation or the cap (default 50), under a
  supervisor that spawns one fresh `flume tick` process per iteration.
- `wake <phase>` / `sleep <phase>` — add / remove `<flumeDir>/awake/<phase>`.
- `job new|run|rm|status` — lifecycle verbs over a job's state root
  (`spec/jobs.md`).

Every subcommand answers `--help` / `-h` with usage and its exit codes, and
that short-circuits before any side effect — chain load, baton mutation, agent
invocation. `flume --help` lists all subcommands; `flume --version` / `-v`
prints the package version, read from flume's own `package.json` at
`../package.json` relative to the running module — the same relative position
in a source checkout and in the published tarball. Both top-level flags
short-circuit before state-dir resolution, chain load, and any side effect, so
they answer from any cwd. Only the global `--job` extraction precedes them, and
a `--job` carrying no value refuses first.

Usage-shaped failures exit 2 uniformly: unknown command or job verb, a missing
`<phase>` or `<name>`, an unknown phase, `--entry` with no matching entry, a
`--max` that is missing, non-numeric, or negative (refused before any tick
runs), a resolution-authority conflict (below), a cross-repo `FLUME_DIR`
(below), and the CJS-context refusal (below). Everything else is the tick/loop
exit-code contract in `spec/loop.md`.

The runtime help text is the authoritative statement of the surface;
`docs/CLI.md` carries one prose entry per subcommand covering exit semantics,
side effects, and an example invocation.

## `flume status` owes exactly this

In printed order:

1. Awake phases, or `hibernating`.
2. **Supervisor liveness** — when `<flumeDir>/loop.pid` exists: `supervisor pid
   N live`, or `loop.pid present, process dead — stale`. No pidfile prints
   nothing extra.
3. **Tip claim state** — when HEAD names a ref and a claim file exists for it:
   `tip claimed by pid N`, or `tip claim present, process dead — stale`. A
   detached HEAD or an absent claim both read as silence.
4. **Pending entry count** from `<flumeDir>/plan/pending.json`: `pending: N`,
   `pending: 0` when absent, `pending: unparsable` when present but malformed —
   the same loose read `flume job status` performs (`readPendingLoose`,
   `src/job.ts`), so a corrupt queue reads identically on both surfaces.
5. **Chain-declared extras**, behind a best-effort chain load that can never
   fail status — a missing or broken chain silently withholds them: the
   friction count when `Chain.friction` is declared and its dir holds files,
   and one line per pending entry blocked on a `requiresCapability` the chain
   has not asserted.

It never prints a commit. `git log -1` already answers that; a HEAD sha
restated beside git is precisely the shape `engineering.md`'s *derived state is
computed, never restated beside its source* names; and printing it would hand a
command specced to always exit 0 its first failure mode outside the state root
(a detached HEAD, a repo with no commits). `status` exits 0 on both of those.

Supervisor liveness is on `status` because the awake markers alone cannot
answer the question an operator asks before relaunching. A tree whose
supervisor is still working reads `hibernating` from the baton, and two
supervisors against one tree is what that misreading produces. The liveness
probe is the same shape the job path uses (`liveLoopPid`) — one detection,
shared, not re-derived per surface.

The friction count line belongs in one home. `frictionCountLine`
(`src/Dispatcher.ts`) is the count-and-format helper behind `flume status` and
the loop-end completion summary. The engine announces that mail exists and
never reads it; the declaration and its validation are in `spec/chain.md`.

> **Drift:** `flume job status` does not reach that helper. It re-derives the
> count per job dir (`countFrictionFiles`, `src/job.ts`, reached through
> `jobStatus`) and formats its own column inline — one wording in two homes,
> against `engineering.md`'s *the fix lands at the mechanism* ("detection a
> sibling surface already performs is shared, never re-derived").

## State-root and config-dir resolution

Two independent roots:

- **`flumeDir`** — the mutable-state root: the baton (`awake/`),
  `plan/pending.json`, worktrees, prior-attempt records, `loop.pid`.
  `FLUME_DIR` relocates it.
- **`configDir`** — the chain and prompts dir: `<configDir>/chain.ts`, and
  `phase.promptPath` joins it. `FLUME_CONFIG_DIR` relocates it.

Both default to `<repoRoot>/.flume`; a set-but-relative value resolves against
cwd. Setting both to one directory co-locates config and state.

`--job <name>` (or `FLUME_JOB`) retargets only the `flumeDir` default, to
`<repoRoot>/.flume/jobs/<name>`. `configDir` never follows the job — the chain
is repo-resident, so a shared chain finds its sibling `prompts/` from any job
with no chain-dir token and no dynamic path computation.

**Conflict rule.** `--job` alongside an explicitly-set `FLUME_DIR` is a usage
error, exit 2: two resolution authorities over one state root. `--job` with an
explicit `FLUME_CONFIG_DIR` *composes* — the authority was always over state,
and config never belonged to the job; state stays namespaced under the job dir,
so no corruption case exists. `FLUME_JOB` read from the environment also
composes with an explicit `FLUME_DIR` rather than conflicting: on the
loop → tick boundary the child sees all three written-back vars, and the dir
vars *are* the parent's canonical job resolution, so the set dirs win and the
job name rides along for fanout namespacing.

**Canonicalization write-back.** After resolving, the CLI writes the resolved
**absolute** paths back into `process.env.FLUME_DIR` and `FLUME_CONFIG_DIR`,
and — when a job is in play — the bare job *name* into `FLUME_JOB`
(`resolveStateDirs`, `src/cli.ts`). Writing back is the point: a chain loaded later in the same
process (via tsx) and every spawned tick child then read one resolved value
instead of re-deriving the default or falling back to a coincidentally-equal
`configDir`. `FLUME_DIR` is a reliable, always-present source of truth for the
state root, not a maybe-absent caller convenience. The values reach the tick
child through the supervisor's own `process.env`, which `defaultTickRunner`
(`src/Dispatcher.ts`) copies into the child's `env` — plus
`FLUME_QUARANTINED_SLUGS` when the run has quarantined slugs, the one channel
the supervisor's quarantine crosses the process boundary on (read back at
`quarantinedSlugs`, `src/cli.ts`). No var is dropped or rewritten on the way
down.

The guarantee reaches every subcommand, including the job verbs: `resolveStateDirs`
runs ahead of verb dispatch rather than inside the branches that happen to need it,
so `job new` and `job status` load their chain with the same resolved, written-back
environment a tick would see. A factory reading `process.env.FLUME_DIR` during
`job new` gets the resolved state root.

**Cross-repo refusal.** `FLUME_DIR` is absolute and children inherit it, so a nested
invocation in a *different* repository would otherwise write to the outer repo's control
plane — the defect observed 2026-08-03, when a smoke lane run inside a tick planted an
awake flag in the live baton. Provenance is therefore **stamped, never inferred**: the
write-back also writes `FLUME_DIR_RESOLVED_FOR=<repoRoot>`, and `resolveStateDirs` refuses
(`CrossRepoFlumeDirError`, exit 2) only when that stamp is present and disagrees with the
freshly-resolved `repoRoot`. A value typed for this invocation carries no stamp and is never
refused on that basis, whatever its path happens to contain. `.claude/rules/engine-boundary.md`
*Told, not inferred*.

> **Drift:** the stamp does not exist. `impliedRepoRoot` (`src/cli.ts`) instead walks an
> absolute `FLUME_DIR` upward for a segment literally named `.flume` and refuses when that
> segment's parent is not `repoRoot` — provenance reconstructed from a string. It misfires on a
> deliberate relocation the section above sanctions: `FLUME_DIR=/mnt/state/.flume`, typed fresh
> for this repo, is refused as inherited contamination. Shipped tests cover only a relocation
> with no `.flume` ancestor, so the misclassifying case is unpinned.

The teardown promise ("one `rm` removes the whole footprint") is only true if
every mutable artifact lives under `flumeDir`, and the runtime does not own
where a chain puts its per-run artifacts — session captures, scratch files. The
runtime supplies the canonical root; placing artifacts under it is the chain
author's obligation (`spec/chain.md`). A relocated state root is expected to
live outside the working tree, so `.gitignore` needs no entry for it: the
default `<repoRoot>/.flume` is already ignored and an out-of-tree root is
invisible to git by construction.

`--job <name>` is extracted from argv wherever it appears, before dispatch, so
it composes with every subcommand. `flume job run <name>` rewrites itself into
`--job <name> loop [--max N]`; a `--job` naming a different job beside it is
exit 2.

## Bay discovery walks up to the nearest `.flume`

`repoRoot` is resolved by walking up from cwd to the first level holding a
`.flume` — the same resolution git applies to `.git/`. cwd itself counts as
inside the bay: if its basename is `.flume`, `repoRoot` is its parent, no walk
needed. If no ancestor has a `.flume` up to the filesystem root, the fallback
is cwd unchanged, so a first `flume job new` in a fresh, undocked repo still
creates `.flume` there rather than reaching for an unrelated ancestor.
`FLUME_DIR` / `FLUME_CONFIG_DIR` continue to override outright — the walk-up
only changes what `repoRoot` defaults to.

Without it, `repoRoot` was cwd literally, and every state-dir resolution and
every `job` verb built its paths from that one value: run from any
subdirectory, or from inside `.flume` itself, and both dirs pointed at a
`.flume` that does not exist. `flume job status` was the sharp edge — it
printed `no jobs` with no error, a correct-looking answer that is a lie about
where it looked.

Nested bays are not disambiguated: the walk picks the nearest, same as git.

## Direct invocation is detected by realpath

The CLI module runs `main()` only when it was invoked as the binary; importing
it — tests, embedding — must run nothing. The check compares `import.meta.url`,
which resolves through junctions and symlinks to the file's realpath, against
`process.argv[1]`, so `argv[1]` is resolved with `realpathSync` before the
comparison. Through any junction- or symlink-based install (pnpm's linked
store) a raw string comparison never matches, `main()` never runs, and the
process exits 0 having done nothing — a silent no-op that looks like success.
Guards: an undefined `argv[1]` is not direct; a throwing `realpathSync` falls
back to the raw comparison rather than crashing the import.

## A CJS-context host is refused, never relayed

A host repo whose own `package.json` (or the one beside `.flume/chain.ts`)
lacks `"type": "module"` fails chain load inside tsx's ESM loader. Supporting
that context is declined; lying about it with a raw loader stack is the defect.

The engine matches the loader-failure signature family and refuses with a
usage-shaped message naming the fix — the host must carry `"type": "module"` —
exit 2, consistent with other usage errors, with the underlying loader error
kept as debugging detail rather than the headline. Two empirical shapes are
known: `Cannot use import statement outside a module`, and an
`ERR_MODULE_NOT_FOUND` whose path carries tsx's percent-encoded `?namespace=`
query. Detection is deliberately conservative — a genuinely missing dependency
must keep surfacing as itself, so when the signature does not match, the raw
error shows through unshadowed.

Every surface that loads a chain holds the rule: `tick` routes the refusal through
`TickOutcome.usageError` → `tickExitCode`, and `runJobVerb`'s `new` catch tests
`CjsContextLoadError` ahead of its operational branch. Both print it as the headline
and exit 2.

## Exec-local invocation, and no version-coordination machinery

A bay declares `@dtmd/flume` as its own dependency and invokes it through the
package manager (`pnpm exec flume`, an npm script, `npx`). The binary that runs
is the bay's pinned copy *and* the chain's `import "@dtmd/flume"` resolves to
that same copy, natively — one engine per bay, coherent by construction, owned
by the package manager. A global install on PATH is not a supported invocation
path, and it is not detected.

**Flume ships no version-coordination machinery of its own.** CLI startup runs
the invoked engine unconditionally: no launcher, no re-exec, no version probe,
no replacement check, no pin read. The engine does not read the bay's manifest
at startup, so an unpinned invocation and a pinned one behave identically.
Nothing is provisioned into a job dir either — no per-job engine link is
planted; a job chain's import resolves by Node's normal walk-up to the bay's
own install.

The negative space is the ruling, and it is load-bearing. Two generations of
coherence machinery with opposite authority models — a job-dir link making the
chain follow the invoked binary, and a launcher making the binary follow the
bay's pin — composed into repeated field wedges, and both existed only to
compensate for one unexamined premise: a global CLI on PATH as a first-class
invocation path. Remove the premise and both delete. Distribution is not the
harness's mechanism (`engine-boundary.md`), and a subsystem that wedges its own
users is the complexity signal, heeded (`collaboration.md`).

Version mismatch under the doctrine: **let it break.** An out-of-doctrine
invocation fails however it fails; the engine owes it nothing beyond
documentation. A chain-side minimum-engine marker is deferred and
evidence-gated — it ships only if silent-mismatch reports appear *under* the
doctrine.

## Distribution

Published to npm as `@dtmd/flume`; the unscoped name `flume` belongs to an
unrelated package.

- **Build.** `tsconfig.build.json` extends the dev config, flips `noEmit`, and
  emits `dist/` with declarations, declaration maps, and source maps. `dist/`
  is gitignored and ships in the tarball. `prepack` and `prepublishOnly` both
  run the build, so a local `npm pack` cannot ship a stale `dist/`.
- **Tarball contents** are the `package.json` `"files"` allowlist and nothing
  else: `dist`, `bin`, `README.md`, `LICENSE`, `CHANGELOG.md`. There is no
  `.npmignore` — the allowlist is the single source of truth, and CI asserts
  the packed file set matches it in **both** directions: a packed path no entry
  covers (over-inclusion) and an entry that packs nothing (under-inclusion) are
  each a failure.
- **Bin.** `bin.flume` points at `bin/flume.js`, a Node script with a
  `#!/usr/bin/env node` shebang, so npm generates working shims on every
  platform — including the Windows `.cmd` / `.ps1` shims, which invoke it with
  `node.exe` directly and never hunt for `sh.exe`. It reaches the same entry
  (`dist/cli.js`) with argv preserved, stdio inherited, and the child's exit
  code — or terminating signal — propagated. It parses no options, holds no
  environment opinion, and prints nothing of its own. The POSIX `bin/flume`
  shell script stays in the package for direct callers; it walks its own
  symlink chain before computing the package dir, which the Node entry does not
  need because Node resolves its own module path.
- **`tsx` is a runtime dependency, not a dev tool.** Every consumer's
  `.flume/chain.ts` is TypeScript, and `dist/cli.js` loads it via `tsImport`
  from `tsx/esm/api` because plain Node refuses `.ts` from anything under
  `node_modules`. The loader contract lives in the CLI, not the bin shim, so
  the shims stay trivial.
- **ESM-only**: `"type": "module"`, Node ≥ 22, one strict `"."` export. The
  export map, its condition, and the reason are the packaging half of the
  chain-loading contract — see `spec/chain.md`; `src/index.ts` is the canonical
  inventory of what is exported and this file does not restate it.
  `attw --pack . --profile esm-only` runs in CI but is currently non-blocking
  — the pinned CLI crashes pre-analysis upstream — so it is signal, not a
  gate; the `esm-only` profile's suppression of `CJSResolvesToESM` is the
  intended shape, not a defect. The binding declaration-shape check is the
  consumer type-resolution gate below.
- **Declaration resolution is compiled, not asserted.** A blocking CI step
  installs the packed tarball beside `typescript@5` in the scratch consumer
  and typechecks an ESM `.mts` file that imports flume's values and types
  under `module` / `moduleResolution: nodenext` — the strict, faithful
  resolution mode for an ESM-only package, and the leg that exercises the
  exports map's `types` condition. It stands in for the non-blocking attw
  step.
- **Install acceptance is exercised, not asserted.** CI packs, installs the
  tarball into a scratch project, runs the *generated* shim, and loads a
  scaffolded chain — on both the POSIX and the Windows lane. A shim that does
  not start is invisible to every other check in the suite.

  All three fixtures CI installs the tarball against — `CHAIN_FIXTURE` in
  `scripts/smoke-install.mjs` (Windows lane), the POSIX consumer-install heredoc,
  and the POSIX second-reference-chain (backlog-groomer) heredoc, which drives a
  real `wake` + `tick` and asserts on the committed result — export the factory
  form `loadChainModule` requires.

## win32 is a supported host

POSIX remains the primary CI target; win32 is supported, and that commitment is
only real while a red Windows suite blocks a merge — CI runs a
`windows-latest` lane (typecheck, the default test lane, build, and the install
smoke) beside the POSIX lane, which additionally carries the publish-acceptance
steps and the integration lane (`spec/worktrees.md` for the lane split).

Standing consequences:

- **Spawn discipline.** Package-manager binaries are `.cmd` shims on Windows,
  which Node refuses to spawn without a shell (CVE-2024-27980 hardening). Any
  runtime spawn of a non-exe binary goes direct-spawn → win32 `ENOENT` → shell
  retry (`execGate`, `src/builtinGates.ts`) or an equivalent
  platform-conditional; a bare `execFile("pnpm", …)` is a defect. Direct spawn
  is tried first so args keep exact quoting semantics. **The declared
  exception:** the inline-exec path does not share this fallback, because the
  `sh -c` shape it would retry exits 0 with empty stdout under `cmd.exe` — see
  `spec/prompt.md`.
- **Path discipline.** No `"/"`-splitting of filesystem paths — leaf extraction
  is `basename()`, comparison happens on `join()`-built or normalized forms.
  Exception: git porcelain output prints forward slashes on every platform and
  is asserted against literally; splitting a git *ref path* is that exception,
  not a violation.
- **Total path length.** `join(...).length` can exceed win32's ~260-character
  limit where no single component does — a chain-declared friction dir under a
  job's state root, a fanout mirror dir, a revert-note filename. The idiom is
  `join` paired with `toNamespacedPath`, which prepends the `\\?\`
  extended-length prefix on win32 and is a no-op elsewhere. The bar is the
  built path's **depth**, not every fs call: a path whose depth is bounded by
  the runtime's own layout (`<flumeDir>/awake/<phase>`, `<flumeDir>/loop.pid`,
  `.flume/jobs/<name>`) does not need it; a path extending a chain-declared or
  entry-derived segment does. `namespacedJoin` (`src/paths.ts`) is the shared
  helper: it joins and namespaces in one call, and passing it a single path is
  a legitimate use — the join is a no-op and the namespacing is the point.

  > **Drift:** which of the two forms a site uses is not a rule the code
  > follows. Several sites call `namespacedJoin` on a path they already hold
  > (`Dispatcher`'s mirror-drain `readdir`/`mkdir`, `writeRevertNote`'s `mkdir`,
  > `job.ts:countFrictionFiles`), while `src/git.ts` and much of `Dispatcher`
  > call `toNamespacedPath` directly on held paths. The two are interchangeable
  > in effect; nothing enforces a split, and any stated one would be authored
  > rather than observed.

  `job new` additionally pins `core.longpaths` repo-locally on win32. The
  ceiling `git worktree add` imposes is separate and unreachable by this idiom
  — see `spec/worktrees.md`.
- **Test-repo hygiene.** Temp git repos pin `core.autocrlf false` (and any
  future byte-sensitive config) so revert-path byte assertions survive
  host-level git config.

## Versioning policy

- Semantic versioning starting at 0.1.0.
- Pre-1.0, minor versions may break the public API surface; patch versions
  never do.
- 1.0 ships when there is enough usage signal to commit to API stability under
  semver.
- Each public-API breaking change lands under a `### Breaking` subheading in
  `CHANGELOG.md`.
- The version bump and `npm publish` are human-performed at cut time.

The changelog is a **release artifact mined from git history at the cut**, not
a per-commit obligation, and no gate enforces it. A per-commit presence check
is the wrong layer for a release artifact; it was also measurably expensive
(one shared append-only file every entry must touch collapsed mean fanout wave
width from 3.94 to 1.20 across 50 replayed historical queues) and it was not
what it claimed — asserting that a commit *touched* `CHANGELOG.md` is presence
dressed as agreement, which `engineering.md`'s *a seam gate reads what the real
writer wrote* rules out. A build commit's body is the per-ship record.
