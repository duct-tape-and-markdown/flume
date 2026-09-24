# The CLI

This file governs the `flume` binary: the subcommands it offers and what each
owes its caller, how it resolves the state root and config dir from cwd and
environment, how it decides it was invoked as a binary at all, how the package
is built, published, and expected to be invoked, which hosts it supports, and
the versioning promise its public surface carries. Tick semantics, the
supervisor, the locks, and the exit-code contract live in `spec/loop.md`; the
chain declarations the CLI reads in `spec/chain.md`.

## Subcommand surface

`flume <command> [options]`. A bare `flume` with no argument is `tick`.

- `status` — observational; prints baton and liveness state. It never exits
  non-zero on anything it observes — a dead supervisor, a corrupt queue, a
  detached HEAD, a chain that will not load are reports, not failures — and
  refuses (`EX_IOERR`) only when a file it must read is present and unreadable,
  so no observation is printed as its opposite.
  It mutates no baton flag and loads no agent; the one filesystem effect is
  that constructing the baton creates `<flumeDir>/awake/` when absent
  (`Baton`).
- `tick [--phase <name>]` — one phase × one tick: the first awake phase in
  declared order, or the named one (`spec/loop.md`, *Baton — presence wakes,
  absence hibernates*).
- `loop [--max N]` — ticks until hibernation or the cap (default 50), under a
  supervisor that spawns one fresh `flume tick` process per phase it starts,
  each told its phase, up to `supervisorPolicy.maxTicks` at once.
- `wake <phase>` / `sleep <phase>` — add / remove `<flumeDir>/awake/<phase>`.
- `stop` — write `<flumeDir>/stop` and print what happens next: a live supervisor
  finishes its in-flight tick and ends the run; the next `loop` refuses
  until the flag is removed (`spec/loop.md`, *Graceful stop*). Idempotent — the
  flag already present prints the same statement, exits 0. The verb is
  discoverability, not a privileged channel: `touch` on the same path is equally
  the interface, and nothing distinguishes the two writers. There is deliberately
  no `unstop`/`resume` verb — removing the flag is the operator's acknowledgement,
  and an engine verb that removes it would let a script ack a stop no human saw.
- `log [-n N] [--json]` — observational; prints the last N tick verdicts
  (default 10) from `tick-verdicts.jsonl` via `readTickVerdicts`, oldest
  first. The human form is fixed-format lines carrying only fields the
  verdict record already holds (phase, committed, gate results, shipped
  tags, merge outcomes); `--json` emits the records verbatim as JSONL, one
  per line, for a supervising agent. **Facts only, never reclassified**:
  park/bail vocabulary is the chain's, so `log` prints what the record
  states and nothing derived (`engine-boundary.md`, *Told, not inferred*).
  No verdicts file → prints nothing, exits 0. Mutates nothing.
- `render` — prints to stdout what a named phase (and, under fanout,
  `--entry <tag>`) would be handed, invoking nothing: the other half of what
  `check` does for the queue. It runs the dispatcher's own resolution path
  short of the invocation — the same fence, the same pickability verdict, the
  same renderer — over the primary checkout, so nothing is re-derived; an
  earlier verb that previewed its own approximation of all three was removed
  for it. The `<prior-attempt>` block is omitted, and the output's first line
  says so, since a render outside a tick has no attempt to carry; it is never
  reconstructed. An unresolved span exits `EX_DATAERR` naming it, the refusal a
  tick would have bought with an invocation. No `--out`: stdout is the surface,
  and a tick's own record of what it sent stays `rendered-prompts/`.
- `check` — validates the working tree's ledger without spending an
  agent: the real parse (`parsePendingQueue`, the same decode a tick's resolution
  takes) plus fence arithmetic for every entry — declared paths against the
  consumer phase's declared fence, under the same `matchesAny` matching the
  write guard enforces. For any entry both judge, `check` and the pending gate name the same
  offending paths, because one derivation decides; which entries each submits — the
  gate's `fenceWhen` selection, the verb's every-entry read — is each caller's own. Read-only; touches no
  baton flag and invokes nothing. A parse or fence refusal exits
  `EX_DATAERR` (65), naming the entry and the offending paths — the same
  refusal the next tick would have bought with an invocation. Scope is
  deliberately the engine's own mechanics alone: chain gates need a tick's
  `GateContext` and do not run here. A chain declaring no fanout phase has no
  consumer and therefore no fence: the parse still runs, the fence step is
  skipped, and the output says so — `no fanout phase declared; fence not
  checked` — vacuous by design and spelled, never a refusal of every
  declared path.
- `friction [name]` — bare, lists the declared friction channel's notes
  (filename, size, mtime); with `name`, prints that note's bytes verbatim.
  Output is **never interpreted** — the engine's lifecycle guarantee over
  the channel (`spec/chain.md`) is interpretation-freedom, not
  read-freedom, and this verb is the count line's sibling. An undeclared
  channel refuses usage-shaped (exit 2) naming the missing `Chain.friction`
  declaration; a declared-but-absent directory lists empty, exits 0.

Every subcommand answers `--help` / `-h` with usage and its exit codes, and
that short-circuits before any side effect — chain load, baton mutation, agent
invocation. `flume --help` lists all subcommands, and `flume help` is the
same answer, since it is the first thing a new operator types; `flume help
<subcommand>` and `flume --help <subcommand>` are both that subcommand's
`--help` — one decider serves every spelling of help for a name — and an
unknown name in either is usage-shaped (exit 2) like a trailing positional
anywhere else, never silently dropped; `flume --version` / `-v`
prints the package version, read from flume's own `package.json` at
`../package.json` relative to the running module — the same relative position
in a source checkout and in the published tarball. Both top-level flags
short-circuit before state-dir resolution, chain load, and any side effect, so
they answer from any cwd, before any other extraction.

Usage-shaped failures exit 2 uniformly. The category is **any argv the surface
cannot honor as typed** — the instances below are its members, not a closed
enumeration: an unknown command; a missing `<phase>` or `<name>`; an
unknown phase; **an unexpected trailing positional past what a subcommand
consumes** (`tick`, `stop`, and `check` consume none; `wake`/`sleep` exactly
one) — running something other than what the operator typed is the harm this
class exists to refuse, and `flume tick plan` silently ticking whichever phase
was awake is the field-reported shape (gh#1); `--entry` with no matching
entry; a `--max` that is missing, non-numeric, or negative (refused before any
tick runs); a resolution-authority conflict (below); a cross-repo `FLUME_DIR`
(below); and the CJS-context refusal (below). `status` is the one named
exception: specced to fail on no observation, it ignores extras rather than acquiring
its first failure mode. Everything else is the tick/loop exit-code contract in
`spec/loop.md`.

The runtime help text is the authoritative statement of the surface;
`docs/CLI.md` carries one prose entry per subcommand covering exit semantics,
side effects, and an example invocation.

## `flume status` owes exactly this

In printed order:

1. Awake phases, or `hibernating`.
2. **Supervisor liveness** — when `<flumeDir>/loop.pid` exists: `supervisor pid
   N live`, or `loop.pid present, process dead — stale`. No pidfile prints
   nothing extra.
3. **Stop flag** — when `<flumeDir>/stop` exists, one line naming the path and
   the consequence: with a live supervisor, that it will finish the in-flight
   tick and end the run; without one, that the next `loop` refuses
   until the flag is removed. Absent flag prints nothing. This line exists
   because the ack ritual (`spec/loop.md`, *Graceful stop*) only works if the
   operator who forgot the flag finds it where they look first.
4. **Tip claim state** — when HEAD names a ref and a claim file exists for it:
   `tip claimed by pid N`, or `tip claim present, process dead — stale`. A
   detached HEAD or an absent claim both read as silence.
5. **Pending entry count** from the chain's declared queue directory (`Chain.pendingDir`)
   when the chain loads, and from the default `<flumeDir>/plan/pending/` when it
   does not: `pending: N`,
   `pending: 0` when absent, `pending: unparsable` when an entry file is malformed —
   the same loose read every observational verb performs, so a corrupt queue
   reads identically on every surface.
6. **Chain-declared extras**, behind a best-effort chain load that can never
   fail status — a missing or broken chain withholds them and says so **as a
   row of this listing**, `chain: failed to load — <reason>`, printed before
   the pending count on the same stream as the rest, so a status over a chain
   that did not load never has the shape of a healthy one; nothing above this
   line is withheld, and the count's fall
   back to the default queue path is the one cost that report names: the
   friction count when `Chain.friction` is declared and its dir holds files,
   and one line per pending entry blocked on a `requiresCapability` the chain
   has not asserted.
7. **The live run's spend so far** — when a supervisor is live, agent usage
   totalled by phase from the verdict rows written since the instant the lock
   states it started; absent a
   live supervisor, nothing extra. The number that decides whether a loop
   keeps running is read where the operator looks first.

It never prints a commit. `git log -1` already answers that; a HEAD sha
restated beside git is precisely the shape `engineering.md`'s *derived state is
computed, never restated beside its source* names; and printing it would hand a
command specced to always exit 0 its first failure mode outside the state root
(a detached HEAD, a repo with no commits). `status` exits 0 on both of those.

Supervisor liveness is on `status` because the awake markers alone cannot
answer the question an operator asks before relaunching. A tree whose
supervisor is still working reads `hibernating` from the baton, and two
supervisors against one tree is what that misreading produces. The liveness
verdict is the one `flume loop`'s startup refusal reports for the same
pidfile — one detection, never re-derived per surface.

The friction count line has one home: `flume status` and the loop-end
completion summary print the same line from one source. The engine announces that mail exists and
never reads it; the declaration and its validation are in `spec/chain.md`.

## State-root and config-dir resolution

Two independent roots:

- **`flumeDir`** — the mutable-state root: the baton (`awake/`),
  `plan/pending/`, worktrees, prior-attempt records, `loop.pid`.
  `FLUME_DIR` relocates it.
- **`configDir`** — the chain and prompts dir: `<configDir>/chain.ts`, and
  `phase.promptPath` resolves against it. `FLUME_CONFIG_DIR` relocates it.

Both default to `<repoRoot>/.flume`; a set-but-relative value resolves against
cwd. Setting both to one directory co-locates config and state.

There is no third selector. One checkout resolves one state root, and a
repository running several efforts at once gives each a checkout of its own
(`spec/jobs.md`, *The checkout is the unit of isolation*) — so nothing
retargets `flumeDir` below the root but `FLUME_DIR` itself.

**Canonicalization write-back.** After resolving, the CLI writes the resolved
**absolute** paths back into `process.env.FLUME_DIR` and `FLUME_CONFIG_DIR`,
Writing back is the point: a chain loaded later in the same
process (via tsx) and every spawned tick child then read one resolved value
instead of re-deriving the default or falling back to a coincidentally-equal
`configDir`. `FLUME_DIR` is a reliable, always-present source of truth for the
state root, not a maybe-absent caller convenience. The values reach the tick
child through the supervisor's own `process.env`, which `defaultTickRunner`
copies into the child's `env` — plus
`FLUME_QUARANTINED_SLUGS` when the run has quarantined slugs, the one channel
the supervisor's quarantine crosses the process boundary on. No var is
dropped or rewritten on the way down.

The guarantee reaches every subcommand: `resolveStateDirs` runs ahead of verb
dispatch rather than inside the branches that happen to need it, so every verb
that loads a chain loads it with the same resolved, written-back environment a
tick would see. A factory reading `process.env.FLUME_DIR` gets the resolved
state root whichever verb is running.

**Cross-repo refusal.** `FLUME_DIR` is absolute and children inherit it, so a nested
invocation in a *different* repository would otherwise write to the outer repo's control
plane — the defect observed 2026-08-03, when a smoke lane run inside a tick planted an
awake flag in the live baton. Provenance is therefore **stamped, never inferred**: the
write-back also writes `FLUME_DIR_RESOLVED_FOR=<repoRoot>`, and `resolveStateDirs` refuses
(`CrossRepoFlumeDirError`, exit 2) only when that stamp is present and disagrees with the
freshly-resolved `repoRoot`. A value typed for this invocation carries no stamp and is never
refused on that basis, whatever its path happens to contain. `.claude/rules/engine-boundary.md`
*Told, not inferred*.

The teardown promise ("one `rm` removes the whole footprint") is only true if
every mutable artifact lives under `flumeDir`, and the runtime does not own
where a chain puts its per-run artifacts — session captures, scratch files. The
runtime supplies the canonical root; placing artifacts under it is the chain
author's obligation (`spec/chain.md`). A relocated state root is expected to
live outside the working tree, so `.gitignore` needs no entry for it: the
default `<repoRoot>/.flume` is already ignored and an out-of-tree root is
invisible to git by construction.

## Bay discovery walks up to the nearest `.flume`

`repoRoot` is resolved by walking up from cwd to the first level holding a
`.flume` — the same resolution git applies to `.git/`. cwd itself counts as
inside the bay: if its basename is `.flume`, `repoRoot` is its parent, no walk
needed. If no ancestor has a `.flume` up to the filesystem root, the fallback
is cwd unchanged, so a first run in a fresh, undocked repo still resolves
`.flume` there rather than reaching for an unrelated ancestor.
`FLUME_DIR` / `FLUME_CONFIG_DIR` continue to override outright — the walk-up
only changes what `repoRoot` defaults to.

Without it, `repoRoot` was cwd literally, and every state-dir resolution built
its paths from that one value: run from any subdirectory, or from inside
`.flume` itself, and both dirs pointed at a `.flume` that does not exist. An
observational verb was the sharp edge — it printed a correct-looking answer
that is a lie about where it looked.

Nested bays are not disambiguated: the walk picks the nearest, same as git.

## Direct invocation is detected by realpath

The CLI module runs `main()` only when it was invoked as the binary; importing
it — tests, embedding — must run nothing. The check compares `import.meta.url`,
which resolves through junctions and symlinks to the file's realpath, against
`process.argv[1]`, so `argv[1]` is resolved with `realpathSync` before the
comparison. Through any junction- or symlink-based install (pnpm's linked
store) a raw string comparison never matches, `main()` never runs, and the
process exits 0 having done nothing — a silent no-op that looks like success.
Guards: an undefined `argv[1]` is not direct; a throwing `realpathSync` compares
the unresolved path instead, in the same alphabet, rather than crashing the
import.

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

Every surface that loads a chain holds the rule. Each chain-loading verb that owns an
exit code refuses a CJS-context host at exit 2 — ahead of its own operational branches,
and ahead of the mount-dead code the same verb returns for every other load failure —
and `flume tick` reports the same refusal as a usage outcome. Every one prints it as the
headline; none relays the raw loader error.

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
Nothing is provisioned beside a state root either — no engine link is planted
there; a chain's import resolves by Node's normal walk-up to the bay's own
install.

The negative space is the ruling, and it is load-bearing. Two generations of
coherence machinery with opposite authority models — a state-root link making
the chain follow the invoked binary, and a launcher making the binary follow
the bay's pin — composed into repeated field wedges, and both existed only to
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
  else — the allowlist is its own enumeration, and this page does not restate it. There is no
  `.npmignore` — the allowlist is the single source of truth, and CI asserts
  the packed file set matches it in **both** directions: a packed path no entry
  covers (over-inclusion) and an entry that packs nothing (under-inclusion) are
  each a failure.
- **Bin.** `bin.flume` points at `bin/flume.js`, and `bin.flume-harness` at
  `bin/flume-harness.js` (`spec/harness.md`, *Adoption and upgrade*) — each a Node script with a
  `#!/usr/bin/env node` shebang, so npm generates working shims on every
  platform — including the Windows `.cmd` / `.ps1` shims, which invoke it with
  `node.exe` directly and never hunt for `sh.exe`. It reaches the same entry
  (`dist/src/cli.js`) with argv preserved, stdio inherited, and the child's exit
  code — or terminating signal — propagated. It parses no options, holds no
  environment opinion, and prints nothing of its own. The POSIX `bin/flume`
  shell script stays in the package for direct callers; it walks its own
  symlink chain before computing the package dir, which the Node entry does not
  need because Node resolves its own module path.
- **`tsx` is a runtime dependency, not a dev tool.** Every consumer's
  `.flume/chain.ts` is TypeScript, and `dist/src/cli.js` loads it via `tsImport`
  from `tsx/esm/api` because plain Node refuses `.ts` from anything under
  `node_modules`. The loader contract lives in the CLI, not the bin shim, so
  the shims stay trivial.
- **ESM-only**: `"type": "module"`, Node ≥ 22, a strict, enumerated exports map (`spec/chain.md`). The
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

  Every fixture CI installs the tarball against exports the factory form
  `loadChainModule` requires, on every lane; the second-reference-chain
  (backlog-groomer) fixture additionally drives a real `wake` + `tick` and
  asserts on the committed result.

## win32 is a supported host

POSIX remains the primary CI target; win32 is supported, and that commitment is
only real while the Windows lane is read. CI runs a `windows-latest` lane
(typecheck, the default test lane, build, and the install smoke) on every push
to `main`, beside the POSIX lane, which additionally carries the
publish-acceptance steps and the integration lane (`spec/worktrees.md` for the
lane split). A loop that commits straight to `main` cannot block on a lane that
runs after the push, so the lane is a plan input instead of a merge gate: its
failing test titles are findings the harness package's inbox slice drains
(`spec/harness.md`, *CI lanes as a findings source*), and a red lane is a
queue, never silence. A win32 fix carries the lane-observed input as its
fixture, which is the platform clause of `.claude/rules/engineering.md`, *A fix
ships the test that would have caught it*; a fix without one is a guess and
does not ship.

Standing consequences:

- **Spawn discipline.** Package-manager binaries are `.cmd` shims on Windows,
  which Node refuses to spawn without a shell (CVE-2024-27980 hardening). Any
  runtime spawn of a non-exe binary goes direct-spawn → win32 `ENOENT` → shell
  retry or an equivalent
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
  limit where no single component does — a chain-declared friction dir under
  the state root, a fanout mirror dir, a revert-note filename. The idiom is
  `join` paired with `toNamespacedPath`, which prepends the `\\?\`
  extended-length prefix on win32 and is a no-op elsewhere. The bar is the
  built path's **depth**, not every fs call: a path whose depth is bounded by
  the runtime's own layout (`<flumeDir>/awake/<phase>`, `<flumeDir>/loop.pid`)
  does not need it; a path extending a chain-declared or
  entry-derived segment does. `namespacedJoin` is the shared
  helper: it joins and namespaces in one call, and passing it a single path is
  a legitimate use — the join is a no-op and the namespacing is the point.

  Worktree provisioning additionally pins `core.longpaths` repo-locally on
  win32, before any path nested deep enough to need it exists. The ceiling
  `git worktree add` imposes is separate and unreachable by this idiom — see
  `spec/worktrees.md`.
- **Test-repo hygiene.** Temp git repos pin `core.autocrlf false` (and any
  future byte-sensitive config) so revert-path byte assertions survive
  host-level git config. The repository itself pins `eol=lf` through
  `.gitattributes`, so a checkout on win32 carries the bytes the suite's
  fixture-literal comparisons read.
- **The lane's subject.** The win32 lane carries the whole default suite, and
  what it proves is the engine's win32 paths — shim spawn, total path length,
  the git alphabet against the host separator, canonical roots — and every
  case whose subject is platform-neutral. A case whose subject is POSIX error
  semantics — a permission bit that denies, a symlink loop, a symlink the host
  refuses to create — declares its host and skips on win32 with the reason
  stated, never silently. The suite's denial primitive is structural wherever
  the code path allows it (`.claude/rules/platform-facts.md`, *`chmod` denies
  nothing on win32*), so a denial case runs on both hosts by default and
  declares a host only where no structural substitute exists. A red title on
  the lane is a defect in the engine or in the fixture, never an accepted
  platform gap.

## Versioning policy

- Semantic versioning starting at 0.1.0.
- Pre-1.0, minor versions may break the public API surface; patch versions
  never do.
- 1.0 ships when there is enough usage signal to commit to API stability under
  semver.
- Each public-API breaking change lands under a `### Breaking` subheading in
  `CHANGELOG.md`.
- Every minor whose changelog carries a `### Breaking` section has a
  migration note under `docs/`, walking each break with before and after; a
  note opens by naming any earlier minor it does not cover, so a consumer
  jumping more than one version reads that one first.
- The mined draft closes `### Breaking` with a `### Uncategorized` subheading over every
  non-breaking entry, so the draft leads with breaks as the curated changelog does, and
  the second heading is the curating human's cue for what is still unsorted. A
  subheading renders only over a non-empty bucket; an empty one has no cue to give.
- The version bump, the changelog curation, the release commit, and the tag are
  human-performed at cut time. The push of a `v*` tag publishes: a CI job
  publishes the tagged tree to the registry under the repository's `NPM_TOKEN`
  secret, skips when that version already resolves there, and then installs
  the published tarball from the registry and runs the shim — the install
  acceptance the local smoke performs against a pack, pointed at the registry.
  A tag the registry does not resolve after that job is red on its lane, never
  a day's silent lag.

The changelog is a **release artifact mined from git history at the cut**, not
a per-commit obligation, and no gate enforces it. A per-commit presence check
is the wrong layer for a release artifact; it was also measurably expensive
(one shared append-only file every entry must touch collapsed mean fanout wave
width from 3.94 to 1.20 across 50 replayed historical queues) and it was not
what it claimed — asserting that a commit *touched* `CHANGELOG.md` is presence
dressed as agreement, which `engineering.md`'s *a seam gate reads what the real
writer wrote* rules out. A build commit's body is the per-ship record.
