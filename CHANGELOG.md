# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0: minor versions may introduce breaking changes to the public API surface
(see `spec/RELEASE-v0.1.md` §2). Breaking changes land under a `### Breaking`
subheading per `spec/RELEASE-v0.1.md` §9.

## [Unreleased]

### Breaking

- `GateContext.repoRoot` is no longer optional
  (`.claude/rules/engineering.md` "Narration is the ladder's bottom rung" —
  GATECONTEXT-REPOROOT-REQUIRED): every dispatcher-constructed context has
  set it since v0.7 §6, so the `?` only let stale hand-built fixtures
  compile. A hand-built `GateContext` (a gate's own test) must now set
  `repoRoot`.

- A chain module now default-exports a **factory**, `(api) => ({ chain })`,
  instead of a `Chain` object (v0.11 §6). Every engine value a chain
  composes with — gates, agent constructors, schema helpers, `git`
  read-helpers, `readTickVerdicts`, the error classes it branches on with
  `instanceof` (`CjsContextLoadError`, `PendingParseFailure`,
  `InlineExecRenderError`, `TipClaimHeldError`) — arrives on that `api`
  parameter; a chain's only remaining
  engine import is `import type`, which is erased at runtime. `agent` and
  `forkResolver` move from named module exports onto the factory's return
  (`{ chain, agent, forkResolver }`), because a named export cannot receive
  the API. A default export that is not a function is refused, naming the
  migration, rather than falling back to the old shape.

  This removes the dual-engine process class by construction. A chain that
  imported engine values resolved them by walk-up from its own directory,
  so whenever the running engine was not the copy that walk-up found, one
  process held two engines — one driving the dispatcher, one building the
  chain's phases — with `instanceof` and module-level state split across
  them *at equal versions*, nothing reporting it, and commits as the
  output. It also fixes a globally-invoked engine dying with a raw
  `ERR_MODULE_NOT_FOUND` for the package that was executing. New exports:
  `FlumeApi`, `ChainFactory`. See `docs/MIGRATING-0.11.md` §2.

- The `job/<name>` branch convention is retired from `job new`/`run`/`rm`
  (v0.11 §2/§3): `job new` no longer creates or checks out a branch — it
  baseline-commits the seeded harness on the current HEAD and leaves it
  there; `job run` no longer asserts or checks out `job/<name>`; `job rm`
  no longer checks out the branch, and its cleanup commit lands on the
  current HEAD instead. A job is now exactly `.flume/jobs/<name>/` — the
  operator's branch is never touched, so `job rm` on an already-removed job
  dir is a usage error (exit 2, "no job") rather than a no-op. The
  tick/loop `HEAD == job/<name>` guard (and its exit-1 documentation) is
  removed — `--job`/`FLUME_JOB` now run on whatever branch is current.
  Existing `job/<name>` branches are the operator's to integrate or delete.

- `flume job extract` and `Chain.harvest` are removed entirely (v0.11 §3):
  the clean-history ending (fork a branch, sync intake, cherry-pick
  non-harness commits, harvest declared paths, delete the job) is no longer
  engine machinery. Run the job on a side branch and integrate it with
  ordinary git — merge keeps the record, squash keeps it clean; friction
  files are still readable off the working tree by their owner (`Chain.friction`,
  unchanged). A repo with a live `job/<name>` branch integrates or deletes it
  by hand; there is no replacement verb.

- An inline-exec span that fails to resolve (non-zero exit, spawn failure,
  `sh` not found, output-cap overrun) now **aborts the prompt render** —
  the agent is never invoked, and the tick classifies as a no-commit
  `render-refused` outcome distinct from a voluntary bail (v0.10 §3). The
  `<exec-failed cmd="...">stderr</exec-failed>` substitution is deleted: a
  chain that relied on a tolerated failing span silently sending anyway
  will now fail its tick loudly instead. The error names every failing
  span's command text and stderr.

### Removed

- `src/git.ts`'s `commitAll` and `isDirty` (`.claude/rules/engineering.md`
  "An export earns its consumer" — GIT-DEAD-EXPORTS-RETIRE): `commitPaths`
  superseded `commitAll` and nothing ever called `isDirty`; LSP
  `findReferences` on both resolved only their own declarations. Neither
  was re-exported from `src/index.ts`.

### Added

- `tscGate`, `vitestGate`, and `eslintGate` accept an optional `cmd`
  override (engine-boundary.md "Capability vs convention" —
  BUILTINGATES-PNPM-HARDCODED-NO-OVERRIDE): each is still a bare `Gate`
  usable directly in a `gates: []` array exactly as before, but is now also
  callable — `tscGate({ cmd: "npm" })` — to run the same check through a
  different package manager's binary instead of hand-rolling `shellGate`
  from scratch. Omitting the call (or calling with no override) is
  byte-identical to today's pnpm-only behavior.

- `PkgManagerOverride` (accepted by `tscGate`/`vitestGate`/`eslintGate`)
  gains an optional `args` alongside `cmd` (BUILTINGATES-CMD-OVERRIDE-PNPM-
  SHAPED-ARGS): the `cmd`-only override above still swaps only the binary
  while args stay pnpm-shaped (`["tsc", "--noEmit"]`, etc), which silently
  misreports an npm chain's gate as "TypeScript errors"/"Lint errors" when
  npm never ran the check at all — npm has no bare `npm tsc`/`npm lint`
  verb and exits with its own "Unknown command" instead. Pass
  `{ cmd: "npm", args: ["exec", "--", "tsc", "--noEmit"] }` for a working
  npm invocation. Omitting `args` (or the whole override) stays
  byte-identical to today.

- `pendingGate` accepts an optional `hint` (engine-boundary.md "Capability
  vs convention" — PENDING-GATE-HINT-OPTION): chain-authored operator
  guidance appended verbatim to both failure messages (the schema-violation
  branch and the fence-pre-check branch), mirroring `shellGate`'s
  `failHint`. A hand-rolled fork had carried this text; the builtin dropped
  it. Omitting `hint` is byte-identical to today's messages.

- `DispatcherOptions` accepts an optional `commitMessage` (engine-boundary.md
  "Capability vs convention" — DISPATCHER-COMMIT-MESSAGE-PREFIX-HARDCODED):
  `commitPendingUpdate` calls it with the tags shipped this wave (empty for a
  footprint-only commit) and the tags whose merge-failure footprints were
  recorded, and commits `pending.json` with whatever string it returns
  instead of the hardcoded `chore(flume): ship ...` / `chore(flume): record
  merge-failure footprints for ...` text — a chain that isn't Flume itself
  can now choose its own ledger-commit wording. Omitting `commitMessage` is
  byte-identical to today's text.

- `JobNewOptions` and `JobRmOptions` accept an optional `commitMessage`
  (engine-boundary.md "Capability vs convention" —
  JOB-SEED-RM-COMMIT-MESSAGE-HARDCODED): `jobNew`'s seed commit and `jobRm`'s
  cleanup commit each call it with the job name and commit with whatever
  string it returns, instead of the hardcoded `chore(flume): seed job ...` /
  `chore(flume): rm job ...` text — the same gap `commitMessage` closed on
  `DispatcherOptions`. Omitting `commitMessage` is byte-identical to today's
  text.

- An advisory per-ref tip claim (v0.11 §4): `flume loop` claims the tip
  (the ref HEAD resolves to) at start and releases it at exit — one flume
  writer per tip, visible from every worktree of one repository. The claim
  lives at `<git-common-dir>/flume/tip-claims/<ref path>` (e.g.
  `.git/flume/tip-claims/refs/heads/main`), exclusive-created and
  pid-liveness reclaimed the same way `loop.pid` already is: a live holder
  refuses the second loop, naming the holder's pid and the claim path; a
  dead holder's claim is reclaimed silently. `tick` and `loop` both refuse
  (exit 1) on a detached HEAD before running any tick — the claim keys on a
  named ref, and a bare `tick` takes no claim itself (loop-level only).
  `flume status` reports the current tip's claim alongside supervisor
  liveness.

- Tip verify (v0.11 §5): a tick now commits only onto the tip it started
  on. The dispatcher records the tip at tick start and re-verifies
  immediately before each commit it drives (the singleton/fanout-worktree
  agent's own commit, checked after the fact via its parent sha; the
  fanout wave's `cherry-pick`s and its trailing pending-ledger commit,
  checked immediately before each). A moved ref refuses the commit instead
  of landing it: the singleton/fanout-worktree case is soft-reverted (the
  agent's output survives on disk, uncommitted — never a defect in the
  work), the fanout wave's cherry-pick/ledger-commit case simply never
  attempts the commit, leaving the entry pending. The tick reports a
  `tipMoved` fact — a sibling to the existing `noCommit` classification,
  never a fifth member of it — surfaced on `TickOutcome`/`TickVerdict` and
  counted as an errored tick in `superviseLoop`'s run summary. This is the
  correctness backstop behind the §4 claim: it catches an operator
  committing mid-tick, a pull moving the ref, and claim-less bare-tick
  collisions (running two ticks hot against one ref with no coordination).

- `Phase.shouldRun` (v0.11 §8): an optional predicate the dispatcher
  consults before rendering the prompt or invoking the agent — once per
  tick for a singleton phase, once per assigned entry for a fanout phase.
  Returning `false` ends the tick as a declined no-op (no agent invocation,
  no commit) while `handoff` still runs and the baton sleeps/wakes as on
  any other no-commit tick; a chain can now decline a tick it already knows
  is a no-op (e.g. plan concluding nothing new needs re-deriving) without
  spending an agent invocation to reach that same conclusion. Undeclared or
  returning `true` is unchanged behavior. The decline is reported as its
  own `declined` fact on `TickOutcome`/`TickVerdict` — a sibling to
  `noCommit`/`tipMoved`, never a fifth `NoCommitMode` — distinguishable
  from a voluntary bail (the agent ran and refused) and from hibernation
  (nothing was awake).

- `src/index.ts` re-exports `ProvisionFailure` and `TerminalMisconfiguration`
  as named types (`.claude/rules/engineering.md` "An export earns its
  consumer" — DISPATCHER-PROVISIONFAILURE-TERMINALMISCONFIG-UNEXPORTED): both
  were already field types on the public `TickVerdict.provisionFailures` /
  `TickOutcome.terminal`, but a chain author had no barrel path to name them
  when typing their own handling of those fields.

- `src/index.ts` re-exports `NoCommitMode` as a named type
  (`.claude/rules/engineering.md` "An export earns its consumer" —
  PROMPT-NOCOMMITMODE-UNEXPORTED): it was already the field type of
  `TickVerdict.noCommit` / `TickOutcome.noCommit` / `TickResult.noCommit`,
  but a chain author had no barrel path to name it when typing their own
  handling of those fields.

### Fixed

- `flume job run <name> --max <value>` now validates `--max` is a finite,
  non-negative number in the `job run` branch itself (`src/cli.ts`), sharing
  the numeric parse with `flume loop`'s own `--max` check, instead of
  deferring to the `loop` block the `job run` args rewrite into. A
  non-numeric or negative value previously passed the `job run` branch's
  weaker `!value || value.startsWith("-")` check, so `jobRun()`'s preflight
  woke `chain.phases[0]` before the numeric check downstream in `loop`
  finally rejected the value and printed `flume loop`'s usage line instead
  of `job run`'s (`.claude/rules/engineering.md` §Loud or nothing).
- `resolveStateDirs`' job-resolution doc comment (`src/cli.ts`) now sits
  directly above `resolveStateDirs` itself. It previously sat between
  `JobResolutionConflictError` and `resolveRepoRoot`'s own doc comment,
  separated by a blank line, so TypeScript attached it to nothing — hover on
  `resolveStateDirs` showed the bare signature while the conflict rule, the
  write-back rationale, and the `FLUME_JOB` composition case read as current
  narration reaching no consumer (`.claude/rules/engineering.md` §Narration
  is the ladder's bottom rung).
- `validateJobName`'s doc comment (`src/job.ts`) no longer cites the
  shipped-and-gone `JOB-RESOLUTION` pending tag as live accepted debt; it now
  names the current condition directly — `resolveStateDirs` (`src/cli.ts`)
  composes `--job` straight into `.flume/jobs/<name>` without routing through
  this check — so a sweep can evaluate it without chasing a closed pending
  entry (`.claude/rules/engineering.md` §Narration is the ladder's bottom
  rung).
- `flume loop`'s cross-process lock now reads pidfile liveness through
  `liveLoopPid` (`src/job.ts`) instead of re-deriving the same
  read/parse/`process.kill(pid, 0)` sequence inline — the lock and `flume
  status`'s supervisor-liveness probe (v0.7 §17) now go through one
  mechanism, pinned by an agreement test
  (`.claude/rules/engineering.md` §The fix lands at the mechanism).
- `withSessionCapture`'s default `filename` now suffixes the ISO timestamp
  with the invocation's `cwd` basename, matching the discriminator this
  repo's own chain already applied on top of the default. Two fanout
  invocations opening in the same clock millisecond (distinct cwds, no
  `filename` override) collided on one path, and the second
  `createWriteStream` silently truncated the first invocation's transcript —
  no error, one capture just vanished (`.claude/rules/engineering.md` §Loud
  or nothing).
- `withTerminalRenderer`'s `relativize` now strips the invocation `cwd`
  prefix on either `/` or `\`, not just `/`. On win32 every rendered
  Read/Write/Edit/MultiEdit/NotebookEdit line showed the full absolute
  `file_path` instead of the relative path the tag beside it already
  shortens to, because the strip only recognized the POSIX separator
  (`.claude/rules/engineering.md` §The fix lands at the mechanism).
- `Dispatcher.ts`'s voluntary-bail message extraction
  (`finalAgentMessage`/`assistantTurnText`) now calls `src/Agent.ts`'s
  `parseNdjsonLine`/`contentBlocksOfType` instead of re-deriving its own
  NDJSON line-parse and `message.content` block-walk — the same parse
  `withTerminalRenderer`'s stream-json rendering already implements. Both
  consumers now diverge only on which event/block types they keep
  (`.claude/rules/engineering.md` §The fix lands at the mechanism,
  DISPATCHER-STREAMJSON-PARSE-DUP).
- `Dispatcher.ts`'s ship-detection check (§12, "does this cherry-picked
  commit touch a declared file") now glob-matches `commitTouchedPaths`
  against `declaredPaths(entry)` via `matchesAny`, the same matcher the
  entry-scope write guard (`writablePathsGate` at the afterCommit gate loop)
  already applies to that identical list. `matchesAny`/`globToRegex` move
  from `src/builtinGates.ts` to `src/paths.ts` so both call sites share one
  implementation. Previously the write guard glob-matched while ship
  detection compared with `Array.includes` — a fanout entry that declared a
  glob (`nodes/territory-*.json`) and shipped a matching file
  (`nodes/territory-01.json`) passed the write guard, cherry-picked onto
  trunk, then failed the literal-equality ship check and stayed pending
  forever: landed work re-attempted every tick, never draining
  (`.claude/rules/engineering.md` §The fix lands at the mechanism,
  SHIPDETECT-LITERAL-VS-GLOB-DISAGREEMENT).
- `readPriorAttempt`'s `existsSync`/`readFile`, `writePriorAttempt`'s
  `mkdir`/`writeFile`, and `clearPriorAttempt`'s `rm` on `priorAttemptPath`
  now route through `toNamespacedPath`, the same idiom the §8 reverted-prose
  snapshot siblings above were fixed with — here the win32 ~260-char
  total-path limit is driven by the §5 record's own flat filename
  (`<flumeDir>/prior-attempts/<key>.json`) rather than a nested diff path,
  reachable at the longest tag `parsePending` accepts. Two failure modes in
  one function pair: `writePriorAttempt`'s `mkdir` was uncaught and threw
  `ENAMETOOLONG` into every render-refused/tip-moved/gate-revert/
  voluntary-bail caller; `readPriorAttempt`'s `existsSync` returned `false`
  on a too-long path by Node's own contract, silently reporting "no prior
  attempt" instead (v0.4 §6).
- `snapshotRevertedFiles`'s `mkdir`/`writeFile` now route the snapshot
  destination and its dirname through `toNamespacedPath`, the same idiom
  `writeRevertNote`/`harvestFriction`/the friction counters above were fixed
  with — here the win32 ~260-char total-path limit is driven by the
  reverted commit's own diff depth rather than `chain.friction`, but the
  unwrapped `join(dir, rel)` shape and the silently-swallowed best-effort
  catch are identical: a deep repo path lost its §8 recovery snapshot
  without any signal (v0.4 §6).
- `snapshotRevertedFiles`'s own stale-snapshot `rm(dir, { recursive: true
  })` (dropping the prior revert's tree before rewriting it) and
  `clearPriorAttempt`'s `rm(revertedSnapshotDir(key), { recursive: true })`
  (dropping it on a clean ship) now also route through `toNamespacedPath`,
  closing the gap the mkdir/writeFile fix above left open on the two rm
  call sites walking the same deep dir. The stale-snapshot rm silently
  swallows its own failure (best-effort, same as the mkdir/writeFile it
  sits beside), so a second revert under one key left the prior deep
  snapshot un-replaced; `clearPriorAttempt` has no surrounding try/catch on
  its caller path, so a clean ship after a deep-path revert threw
  `ENAMETOOLONG` out of the tick instead (v0.4 §6).
- `createWorktree`'s `existsSync` check, its stale-worktree `rm` fallback,
  and its `mkdir(dirname(path))` now route through `toNamespacedPath`, the
  same idiom `writeRevertNote`/`harvestFriction`/the friction counters/
  `snapshotRevertedFiles` above were fixed with — here the win32 ~260-char
  total-path limit is driven by the worktree base dir nested under a job
  namespace and the entry tag slug. Unlike those siblings this path was
  visibly stuck rather than silently wrong: the caller already catches,
  logs, and leaves the entry pending for retry, but the retry hit the same
  unwrapped join every time (v0.4 §6).
- `acquireTipClaim`'s `mkdir`/`writeFile`/`unlink`, `liveTipClaimPid`'s
  `existsSync`/`readFile`, and `release`'s `unlinkSync` now route
  `tipClaimPath` through `toNamespacedPath`, the same idiom
  `writeRevertNote`/`harvestFriction`/the friction counters/
  `snapshotRevertedFiles`/`createWorktree` above were fixed with — here the
  win32 ~260-char total-path limit is driven by `refPath` mirrored as
  directories under `<commonDir>/flume/tip-claims`, the same branch naming
  (`flume/<namespace>/slugify(entry.tag)`) `createWorktree` produces.
  Unlike those siblings, `acquireTipClaim`'s `mkdir` had no surrounding
  try/catch at all and `writeFile`'s only swallowed `EEXIST` — so the
  miss propagated `ENAMETOOLONG` out to `cli.ts`'s rethrow, crashing
  `flume loop`/`run` on win32 rather than silently degrading (v0.4 §6).
- `Dispatcher.createWorktree` now pins `core.longpaths` on `repoRoot` before
  `git worktree add`, closing a win32 MAX_PATH gap fanout worktrees hit
  identically to job dirs (`job.ts` already pinned it for its own deep
  paths; the two call sites now share one `pinLongPaths` helper in
  `src/git.ts` instead of `job.ts` carrying a second inline implementation)
  (v0.4 §6).
- `removeWorktree`'s fallback `rm` and `existsSync` now route `path` through
  `toNamespacedPath`, the same idiom `createWorktree`/`acquireTipClaim`
  above were fixed with — same worktree-dir depth as those siblings, just
  on the removal side. On a fanout teardown loop the throw is caught and
  aggregated as a survivor, so this was a false "leak" report rather than a
  crash: `createWorktree`'s own stale-cleanup call site already routed
  through the wrapped fallback, so only removal's own two calls were left
  unwrapped (v0.4 §6).
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
- `builtinGates.ts`'s `ShellGateOptions` and `EntryWriteScope` drop their
  export: each resolves only to its own declaration plus the one in-module
  signature that uses it, and neither is re-exported via `src/index.ts`
  (`.claude/rules/engineering.md`, "An export earns its consumer").
  `shellGate` and `writablePathsGate` stay callable with an inline object
  literal exactly as before.
- `renderSchemaForPrompt`'s `files.retire` hint no longer advertises "path
  or symbol" — `touchedPaths()` and `pendingGate`'s fence pre-check treat
  every `retire` element as a path, so a plan entry that took the hint at
  its word and declared a symbol was refused by the fence on a guaranteed
  revert (`.claude/rules/engineering.md`, "A seam gate reads what the real
  writer wrote").
- An unparseable `pending.json` no longer reads as an empty queue. The
  reads that decide pickable work (`Dispatcher.tick()`'s singleton/fanout
  starts) and the rewrite a ship wave derives (`commitPendingUpdate`) now
  refuse — the tick returns a `failed` outcome (the `EX_MOUNT_DEAD` class)
  instead of reporting nothing pickable and hibernating clean, or
  committing `[]` over the whole file. `flume render` refuses the same way
  instead of printing the parse errors and rendering a prompt over an
  empty queue anyway (`.claude/rules/engineering.md`, "Loud or nothing").
- `pendingGate`'s fence pre-check no longer reads `touchedPaths()`, which
  folds in dispatcher-written `observedFiles` — a footprint signal, not a
  declaration. An entry whose declared `files` all clear the target fence
  but whose `observedFiles` names a path outside it (a prior tick's
  downstream write, unreachable under this repo's chain today but live
  once a target fence differs from the phase that recorded the footprint)
  was refused as a fence violation the authoring phase has no way to fix.
  `PendingSchema.ts` splits a new `declaredPaths()` (files.new+edit+retire
  only) out of `touchedPaths()` (adds `observedFiles`); `builtinGates.ts`,
  `Dispatcher.ts` (both inline declared-file lists), and `Prompt.ts`
  (`effectiveFenceLines`) each call the shared helper instead of
  re-deriving the same union inline (`.claude/rules/engineering.md`,
  "The fix lands at the mechanism").
- `flume loop --max` now refuses a missing, non-numeric, or negative value
  (exit 2, usage message) instead of parsing to `NaN`, which made the loop
  run zero ticks and exit 0 — a typo'd cap was indistinguishable from a
  clean hibernation (`.claude/rules/engineering.md`, "Loud or nothing").
  `--max 0` is unaffected: it still runs zero ticks and exits 0.
- `flume status` now prints the pending entry count §3 requires
  (`pending: N`; `pending: 0` when `plan/pending.json` is absent;
  `pending: unparsable` when it exists but fails to parse) — previously
  omitted entirely, and a corrupt file was dropped silently rather than
  surfaced. `flume status` and `flume job status` now share one probe
  (`readPendingLoose`, `src/job.ts`) for the count, so a corrupt file reads
  identically on both surfaces.
- `PendingSchema.ts`'s `TAG_MAX_LENGTH` and `Dispatcher.ts`'s
  `writeRevertNote` filename each restated the other's arithmetic in prose,
  with nothing driving the schema's ceiling through the real writer — a
  drift in either would silently overrun filesystem NAME_MAX and lose the
  revert note (a warn line, swallowed inside `writeRevertNote`'s
  best-effort catch) instead of failing loudly. `TAG_MAX_LENGTH` is now
  exported and pinned against the real writer in
  `tests/Dispatcher.test.ts`, "revert note to the friction channel (§5)": a
  real gate-revert on the longest tag `parsePending` accepts asserts the
  real filename lands on disk within NAME_MAX
  (`.claude/rules/engineering.md`, "A seam gate reads what the real writer
  wrote").
- `writeRevertNote`'s `mkdir`/`writeFile` now route the friction dir and
  note path through `node:path`'s `toNamespacedPath` (the win32
  extended-length `\\?\` prefix; a no-op on POSIX), so the write survives
  win32's ~260-char total-path limit even when `TAG_MAX_LENGTH`'s
  per-component bound holds. `core.longpaths` (v0.4 §6, above) only governs
  git's own path handling — it never reaches Node's `fs` calls — so a deep
  `flumeDir`/friction-channel nesting still silently dropped the note
  (swallowed by the existing best-effort catch) after that fix shipped
  (v0.4 §6).
- `harvestFriction`'s `readdir`/`mkdir`/`rename` (and the `EXDEV`
  `copyFile`/`rm` fallback) now route the worktree-local mirror dir and the
  primary friction dir through `toNamespacedPath`, the same idiom
  `writeRevertNote` above was just fixed with. The mirror dir nests a
  fanout worktree path (itself at least as deep as the job dir, v0.4 §6)
  under `chain.friction`, so it hit the identical win32 ~260-char
  total-path limit — a deep friction channel silently dropped the
  worktree's friction note (swallowed by the existing best-effort catch)
  instead of harvesting it before worktree removal (v0.4 §6).
- `job.ts`'s `countFrictionFiles` (`jobStatus`'s `frictionCount`) and
  `Dispatcher.ts`'s `frictionCountLine` (`flume status` / `flume job
  status`'s friction line) now route their `readdir` through
  `toNamespacedPath`, the same idiom `writeRevertNote` and `harvestFriction`
  above were just fixed with — both joined `chain.friction` onto a state
  root unwrapped, so a deep friction channel hit the identical win32
  ~260-char total-path limit and silently under-reported: `readdirSync`'s
  swallowed `ENAMETOOLONG` read as "0 files" (`jobStatus`) or "no friction
  line" (`frictionCountLine`) instead of the real count (v0.4 §6).
- CI's "npm pack file-set guard" step now passes `--ignore-scripts` to
  `npm pack --dry-run --json`. `"prepack": "pnpm build"` writes a script
  banner ahead of npm's JSON on stdout, so the guard's `JSON.parse` has
  thrown on every CI run to date (spec/RELEASE-v0.1.md §4); the job's
  earlier `pnpm build` step already produces `dist/`, so the redundant
  prepack rebuild is skipped rather than routed around.
- `writeRevertNote`, `harvestFriction`, `frictionCountLine`
  (`Dispatcher.ts`), and `countFrictionFiles` (`job.ts`) each inlined the
  win32 total-path-limit idiom (`toNamespacedPath(join(...))`) separately.
  A new `namespacedJoin` (`src/paths.ts`) is now the one place that pairs
  them; all four call sites use it instead of re-deriving the wrap.
  Behavior-identical today — the fix is the shared mechanism, pinned in
  `tests/paths.test.ts` against a future one-sided edit
  (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
- `chainLoadGate` and `writablePathsGate` each shelled out their own `git
  show --name-only` for the same commit `Dispatcher.ts`'s afterCommit/
  afterMerge gate loops were already about to run every other gate against.
  `GateContext` gains `touchedPaths`, computed once per commit by the
  dispatcher (`git.showNameOnly`) before either gate loop and passed into
  every gate it constructs; both gates now read `ctx.touchedPaths` instead
  of re-deriving it, falling back to their own `git show` only for a
  hand-built `GateContext` that predates the field. Behavior-identical
  today — the fix is the shared computation, pinned in `tests/Gate.test.ts`
  and `tests/Dispatcher.test.ts` against a future one-sided edit
  (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
- `runAfterCommitGates` computed `touchedPaths` once per commit for its own
  gate loop (the dedup above) but discarded it on return; the fanout tick's
  §13 afterCommit-revert footprint capture re-derived the identical commit's
  touched paths via a second `git.showNameOnly` right after, one call site
  short of the dedup it shipped alongside. `runAfterCommitGates` now returns
  `touchedPaths`; the fanout caller reads it instead of re-deriving.
  Behavior-identical today — the fix is the shared computation, pinned in
  `tests/Dispatcher.test.ts` against a future one-sided edit
  (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
- The render-refused catch (persist the §5 record, then log) was duplicated
  inline at both the singleton and fanout render callsites instead of
  routing through a shared method, the precedent `classifyNoCommit` already
  set for the §6 no-commit persist+log. Both callsites now call a new
  `persistRenderRefused`; each still builds its own return shape, matching
  how `classifyNoCommit`'s two callers already differ. Behavior-identical
  today — the fix is the shared computation, pinned in
  `tests/Dispatcher.test.ts` against a future one-sided edit
  (`.claude/rules/engineering.md`, "The fix lands at the mechanism").
- The §5 tip-verify-after-commit check (parent-check, revert via
  `revertTipMovedCommit`, persist the §5 record, log) repeated the same
  render-refused shape at both the singleton and fanout callsites instead of
  sharing one method. Both now call a new `checkTipMoved`, which owns the
  parent comparison and returns whether the tip moved; each callsite still
  builds its own return shape from that boolean. Behavior-identical
  today — the fix is the shared computation, pinned in
  `tests/Dispatcher.test.ts` against a future one-sided edit
  (`.claude/rules/engineering.md`, "The fix lands at the mechanism").

### Changed

- Narration cleanup in `src/Prompt.ts` and `src/builtinGates.ts`
  (`.claude/rules/engineering.md`, "Narration is the ladder's bottom rung" —
  ERA-SCOPED-NARRATION-PROMPT-NEIGHBORHOOD): three "byte-identical to a past
  release" doc comments now point at the tests that pin the exact byte shape
  (`tests/Prompt.test.ts`, `tests/Gate.test.ts`) instead of restating a
  property those tests already cover; `pendingGate`'s doc no longer cites
  the two now-shipped-and-retired pending tags that motivated it, stating
  the condition it guards against instead. No behavior changes.
- Narration cleanup in `src/Dispatcher.ts` and `src/Phase.ts`
  (`.claude/rules/engineering.md`, "Narration is the ladder's bottom rung" —
  ERA-SCOPED-NARRATION-DISPATCHER-NEIGHBORHOOD): the `quarantineScope` /
  `abortThreshold` doc comments (`SuperviseLoopOptions` and
  `Chain.supervisorPolicy`) now point at
  `tests/Dispatcher.test.ts`'s "a chain declaring neither knob gets the
  v0.7 §16 defaults, byte-identical" case instead of restating the claim
  the test already pins; `diskChainLoader` and `superviseLoop`'s doc
  comments no longer compare current behavior against the removed
  in-process loop and content-hash cache, stating the current
  one-resolution-per-process condition directly instead;
  `Phase.setupWorktree`'s doc no longer reassures pre-migration
  void-returning implementations, stating the current return-type contract
  instead. No behavior changes.
- `src/PendingSchema.ts`'s `parsePending` and `parsePendingLoose` shared the
  invalid-JSON wrap and the zod-issues-to-`ParseError[]` mapping verbatim
  instead of one implementation (`.claude/rules/engineering.md`, "The fix
  lands at the mechanism" — PARSEPENDING-DUP-ERROR-MAPPING); both now call
  one `parseJsonOrFail` helper and one `issuesToParseErrors` helper. Error
  output is byte-unchanged. No behavior changes.
- Narration cleanup in `src/index.ts` and `src/setupWorktree.ts`
  (`.claude/rules/engineering.md`, "Narration is the ladder's bottom rung" —
  ERA-SCOPED-NARRATION-BARREL-NEIGHBORHOOD): `index.ts`'s doc comment no
  longer claims there's no `exports` map — `package.json` has declared one
  restricted to `.` since the package went public, and the comment now
  states that condition instead; `setupWorktree.ts`'s doc no longer cites
  `.flume/chain.ts`'s pre-adoption hand-rolled install step as the
  motivating example, since the chain now calls this helper directly. No
  behavior changes.
- `Dispatcher.createWorktree`'s fanout worktree directory name is now
  length-bounded (v0.11 §9 — WORKTREE-DIRNAME-LENGTH-BOUND): a new
  `worktreeDirName` truncates `slugify(entry.tag)` to a fixed budget and
  appends a short hash of the full tag, so two tags sharing a long common
  prefix still land on distinct directories. `TAG_MAX_LENGTH` sizes the
  schema off NAME_MAX (255), a wider ceiling than the one that matters
  here — `git worktree add` itself refuses a worktree path around 200
  chars on win32 (`fatal: '$GIT_DIR' too big`), below MAX_PATH and
  unreachable by `toNamespacedPath` because git builds that path itself —
  so a schema-valid tag's raw slug could already exceed it. Only the fs
  directory name is bounded: the branch name and the §5 prior-attempt key
  keep the untruncated slug, and the full tag is unchanged everywhere else
  it's read (`pending.json`, commit messages, logs). `TAG-LENGTH-BOUND-
  AGREEMENT-PIN` and `PRIORATTEMPT-WIN32-PATH-TOTAL-LIMIT`
  (`tests/Dispatcher.test.ts`) come off their platform skips and now run
  everywhere they're reachable.
- `EntryExtensionField.schema` declares a [Standard
  Schema](https://standardschema.dev) validator (`~standard`) instead of a
  `z.ZodTypeAny` (v0.11 §11 — ENTRYEXTENSION-STANDARD-SCHEMA):
  `composePendingList` now adapts each declared validator at the boundary
  (calls `~standard.validate`, re-raises its issues at the entry-indexed/
  composed path, carries its returned value forward) instead of merging the
  chain's schema object into the engine's own zod graph via `.extend`/`.and`.
  This removes the failure a merge could only guard, never close: a bay
  whose zod copy diverges from the engine's threw an internal `TypeError`
  from inside zod's own internals, past `parsePending`'s `ParseResult`
  contract, naming neither the field nor the version skew. Existing zod
  schemas already satisfy `StandardSchemaV1` — no chain edit needed. A
  validator whose `~standard.validate` returns a `Promise` is refused,
  naming the field, rather than accepted vacuously (a `Promise` read as a
  result object has no `issues`). New type-only export: `StandardSchemaV1`
  (`src/standardSchema.ts`, vendored, no runtime code). `zod` remains a
  private engine dependency — not a peer, not re-exported on `FlumeApi`.

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
- `pendingGate` read `targetFence.writablePaths`/`entryChannelPaths` into a
  snapshot array at construction time, so a declaration-driven chain
  building the target Phase before its fence was fully populated (e.g. a
  getter-backed `writablePaths` resolved from a per-job `declaration.json`)
  got fence-checked against a stale snapshot. The array now builds inside
  `run()`, so every invocation reads the fence's current value.
- `renderSchemaForPrompt` joined `extensionLines` with `",\n"`, so a hint
  ending in a `// comment` had the delimiter appended past the comment
  marker instead of separating the field from the next line. The separator
  now inserts before the trailing comment when one is present, matching the
  core lines' own style.
- The trailing-comment split above then matched the first `"//"` anywhere
  in a hint, so a hint whose own text contains `"//"` (e.g. a URL) got its
  separator spliced mid-string. `lastIndexOf(" // ")` now distinguishes a
  genuine trailing comment (always preceded by a space in this renderer's
  own hints) from an in-string `"//"` (never preceded by one), without a
  language parser.
- Inline-exec (`` !`cmd` ``) spawned `sh` with no ENOENT fallback, so a
  win32 direct-spawn failure produced `<exec-failed>` on every tick instead
  of retrying through the shell. `execGate` is now exported from
  `builtinGates.ts` and reused in `Prompt.ts` rather than duplicating the
  direct-spawn→ENOENT→shell-retry logic a second time.

### Added

- `pendingGate`'s (v0.8 §6) `fenceWhen?: (entry: PendingEntry) => boolean` —
  a predicate selecting which entries the build-fence pre-check applies to,
  so a chain carrying park-exempt `gate.kind` values (e.g. `"parked"`,
  `"deferred"`) can exempt those entries without hand-rolling a fork of the
  gate. Default `() => true` fences every entry, matching prior behavior
  exactly.
- `shellGate` (and `execGate`) gain an optional `env?` option, merged over
  `process.env` for the spawned command — closes the gap that had chains
  hand-forking `shellGate` to scrub or inject vars. Omitting it is
  byte-identical to before.

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
