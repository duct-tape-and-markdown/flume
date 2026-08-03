# Jobs — state roots, verbs, seeding

A job is a state root: one directory of tracked files under `.flume/jobs/<name>/`, on
whatever branch the operator is on. This file governs what a job is, the four verbs that
create, run, discard, and observe one (`src/job.ts`, routed from `src/cli.ts`), the seeding
and runtime-ignore machinery `job new` performs, the HEAD-is-truth trunk contract every job
commits under, and the cross-job boundaries the engine deliberately does not police. State
selection (`--job` / `FLUME_JOB`) is the CLI's — see `spec/cli.md`; the tip claim, tip
verify, loop lock, and exit codes a job's loop runs under are the loop's — see
`spec/loop.md`.

## A job is a state root

`.flume/jobs/<name>/` — tracked files in the working tree. Nothing more. No branch, no
mount, no registration.

- Multiple jobs coexist under one checkout by construction. `--job <name>` / `FLUME_JOB`
  select which state root a tick reads (`resolveStateDirs`, `src/cli.ts`); config and
  prompts stay repo-resident, state is job-resident.
- No engine surface creates, asserts, or checks out a `job/<name>` branch. There is no
  HEAD-equals-branch guard on `tick` or `loop` — the engine has no opinion on which branch a
  state root runs on. HEAD must *be* on a branch, though: `tick` and `loop` refuse a detached
  HEAD, since the tip claim keys on a ref (see `spec/loop.md`).
- Concurrency is a derivation, not a posture. Two jobs run alternately under one checkout
  serialize on the per-tip claim. To run jobs hot simultaneously the operator gives them
  different tips (`git worktree add` — the operator's act, never the engine's). See
  `spec/loop.md` for the claim, `spec/worktrees.md` for what the engine does with worktrees
  of its own.

> **Drift:** `validateJobName` (`src/job.ts`) still justifies its rejection rule, in the doc
> comment and in the error message, as protecting "one branch segment (`job/<name>`)" — a
> branch grammar no code constructs. The rule itself is live and correct as a path-segment
> check; only the rationale is residue.

## Job names are one path segment

`validateJobName` rejects an empty name, a name containing `/` or `\`, and `.` / `..`.
Enforced at the creating verb — `job new`, `job run`, `job rm` all call it before touching
disk. `--job` resolution composes the flag straight into `.flume/jobs/<name>` without routing
through the check: shape is the creating verb's business.

## The trunk is HEAD

Commits land on the checked-out branch of the working tree the run happens in. The runtime
never switches branches — there is no `git checkout` anywhere in `src/`, and no job-branch
grammar in `src/job.ts` (the engine-records-never-navigates doctrine; see `spec/loop.md`).
The only branch grammar the engine holds is the ephemeral fanout branches declared below
(`src/git.ts:addWorktree`'s `-B`, `src/git.ts:deleteBranch`'s `git branch -D`).

- `DispatcherOptions.trunkBranch` does not exist; the absence is pinned type-level
  (`tests/Dispatcher.test.ts`, "Trunk contract — HEAD-is-truth").
- **Declared fanout carve-out.** The engine does construct ephemeral worktree branch names —
  `flume/<slug>`, or `flume/<namespace>/<slug>` when a namespace is set
  (`Dispatcher.createWorktree`) — does create them (`src/git.ts:addWorktree`, `-B`), does
  delete them at teardown (`src/git.ts:deleteBranch`, `git branch -D`), and does cherry-pick a
  wave's per-entry worktree commits onto the tip the tick started on. All of it touches only
  the tick's own record, never a ref the operator chose; it is named here as a boundary the
  engine declares rather than an unnoticed violation. The namespace is the job name, resolved
  by the CLI from `FLUME_JOB` and passed to the dispatcher explicitly — the dispatcher never
  sniffs `flumeDir` for a job name. Mechanics in `spec/worktrees.md`.

## `flume job new <name>` — seed a state root

Non-mutating with respect to git topology: no branch created, no checkout, HEAD stays where
the operator left it. Idempotent on re-run. In order (`jobNew`, `src/job.ts`):

1. Validate the name (usage error).
2. Require `<configDir>/chain.ts`. A job that could never `run` must not be creatable, so a
   chainless repo is a usage error before anything is written.
3. Validate a declared `Chain.seedDir` **before** touching the state root — declared-but-absent
   is a usage error, and checking it first is what keeps a stray empty job dir from being left
   behind.
4. `mkdir` the state root; copy `seedDir` in verbatim, recursive, skip-existing. Re-run fills
   gaps (a stub added to the seed dir reaches existing jobs) and never clobbers a worked file.
   An undeclared `seedDir` seeds nothing and warns nothing — a bare job whose state accretes
   from ticks.
5. Ensure the runtime ignore entries (below) — written before the baseline `add`, so runtime
   state never enters the commit.
6. `git config core.longpaths true`, win32 only, repo-local, idempotent (`pinLongPaths`,
   `src/git.ts`). Job dirs nest deep; this spares the operator MAX_PATH failures up front.
7. Pathspec-scoped baseline commit of the seeded harness **on the current HEAD**, so plan and
   build produce clean deltas. Scoping to the job dir leaves anything the operator pre-staged
   elsewhere in the index instead of sweeping it into the seed. Nothing staged → no commit,
   logged as already baselined.

The seed source is the chain's declared `seedDir` (see `spec/chain.md`); there is no
`--template` flag. The commit message is caller-overridable (`JobNewOptions.commitMessage`) —
the `chore(flume): seed job <name>` wording is a chain's convention, not the engine's.

No per-job engine link is provisioned. A job chain's `import "@dtmd/flume"` resolves by
Node's ordinary walk-up to the bay's own install — the same copy that is executing. A stale
`<jobdir>/node_modules/@dtmd/flume` link left by an older job dir is accepted and inert: it
points at an engine that once ran there, nothing reads or repairs it, and `job rm` removes the
dir wholesale. It is also unreachable, not merely unread — chain and prompts are
repo-resident (`loadChainModule(resolve(configDir, "chain.ts"))` and
`join(configDir, phase.promptPath)`, `src/Dispatcher.ts`), so nothing is ever resolved from
inside a job dir and the walk-up never passes through one.

## Runtime ignores

`RUNTIME_IGNORES` (`src/job.ts`) is the runtime-owned set merged into every job dir's
`.gitignore`:

```
awake/
prior-attempts/
worktrees/
node_modules/
loop.pid
```

- `node_modules/` stays even though no link is planted: it is harmless and keeps stray
  artifacts out of the baseline commit.
- A declared `Chain.friction` dir joins the set (normalized to forward slashes and a single
  trailing slash) — the friction channel is gitignored by machinery, not by per-repo habit.
  The declaration itself lives in `spec/chain.md`.
- Merge semantics: create the file if absent, otherwise append only the entries that are
  missing. Seed-authored lines and their order are preserved verbatim. Idempotent.
- The runtime owns its own layout, and only that. Chain-convention directories (`sessions/`)
  are the seed's to add.

## `flume job run <name>`

Wake the chain's entry phase iff the job's baton is hibernating, then run the standard loop
under the job resolution.

- No existence precondition on `<name>`. `jobRun` validates the name's shape, then constructs
  `new Baton(flumeDir)` — whose constructor `mkdir`s `awake/` recursively. A name never passed
  to `job new` is not refused: it materializes a bare state root, wakes the entry phase there,
  loops against it with no seed and no `pending.json`, and appears in `flume job status`
  afterward. A job is a directory, not a registration (above), so there is no registry to
  check against — `rm`'s refusal on an unknown name (below) does not generalize to `run`.
- The entry phase is `chain.phases[0]` — the chain's first declared phase, content-free by
  decision. No phase name is hardcoded in the engine. A chain declaring no phases is an
  operational failure.
- A non-hibernating baton is left untouched and the awake phases are logged: mid-job resume,
  entry phase not re-woken.
- No branch is asserted or checked out; the loop runs on whatever branch HEAD is on — a
  branch it must be, since `loop` refuses a detached HEAD (above).
- The loop itself is the CLI's ordinary `flume loop` path — lock, supervisor, `--max N`, and
  exit codes identical to `flume --job <name> loop`. See `spec/loop.md`.

## `flume job rm <name>` — the discard ending

Throw the harness away, keep the work.

1. A `<name>` naming no job dir is a usage error.
2. Refuse while the job's `loop.pid` records a live pid (`liveLoopPid` — the same pid-liveness
   probe the loop lock and `flume status`'s supervisor check use, one implementation).
   Removing a state root out from under a running supervisor would strand its ticks.
3. `git rm -r` the tracked harness plus a pathspec-scoped cleanup commit **on the current
   HEAD** (nothing tracked → no commit). Message overridable, as with `job new`.
4. `fs.rm` the untracked runtime remnants the ignore entries kept out of git — including a
   stale `@dtmd/flume` junction or symlink from an older job dir, which is unlinked without
   being followed, so the link target is never touched.
5. `git worktree prune` for the job's stale fanout metadata.

The operator's branches are never touched. Integration and branch deletion are the operator's
acts.

## `flume job status`

Enumerate the directories under `.flume/jobs/`, sorted, one line each. Purely observational:
it reads what exists and writes nothing (a job's `Baton` is constructed only when its `awake/`
dir is already on disk, because the constructor would otherwise create it).

Per job: the awake phases from that job's baton, or `hibernating`; the entry count from
`<jobdir>/plan/pending.json`; and, where the repo chain declares `Chain.friction` and the
count is non-zero, the number of friction notes awaiting routing. An empty or missing jobs
dir prints `no jobs`.

- Pending count is read through the same chain-less loose parse `flume status` uses
  (`readPendingLoose`), so a corrupt file reads identically on either surface: absent is `0`
  (nothing planned is nothing pending), unparsable is surfaced as `unparsable` rather than
  thrown — one broken plan never hides the others.
- The chain load that supplies the friction dir is best-effort: a missing or broken chain
  silently withholds the friction counts and never fails the verb.

## There is no clean-history ending

`job extract` and `Chain.harvest` are removed, and nothing replaced them. A deliverable whose
history must not carry harness commits runs the job on a side branch and integrates however
the deliverable demands, with ordinary git — the implementation's branch strategy, never
engine machinery. Friction files are read off the working tree by their owner.

The engine's remaining friction obligation is the wave-teardown harvest, which exists only
because nothing but the engine is present when a fanout worktree dies — see
`spec/worktrees.md`.

## Cross-job boundaries the engine does not police

- **`.git/worktrees` metadata contention across jobs is accepted.** A race fails a git command,
  which fails a tick, not the repo; the entries stay pending and the stateless-tick posture
  self-heals on retry.
- **Cross-job `writablePaths` overlap is the operator's responsibility.** The write fence is
  phase-wide and repo-root-relative (`Phase.writablePaths`, enforced post-commit by
  `writablePathsGate`); nothing scopes it per job. Two jobs running concurrently whose phases
  claim overlapping globs are not separated by the engine.

## Usage errors are exit 2

Every job verb splits its failures: `JobUsageError` — a bad name, a `new` on a chainless repo,
a declared `seedDir` absent on disk, an `rm` naming no job — maps to exit 2 at the CLI.
Anything else (a live loop blocking `rm`, a git failure, a chain with no phases) is an
operational failure, exit 1.

The chainless case is `new`'s alone. `jobNew` guards `<configDir>/chain.ts` with an
`existsSync` before loading it, because a job that could never `run` must not be creatable.
`jobRun` calls `loadChainModule` unguarded, so on a chainless repo the loader's own plain
error surfaces — exit 1. That diverges from reaching the same chainless repo
through the loop, where a child tick's load failure is mount-dead and both
`tick` and `loop` exit 69 (`spec/loop.md`, *Exit codes*). The preflight refuses
before any tick exists to classify, so it has no mount-dead code to return.
