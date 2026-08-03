# Flume CLI

`flume <subcommand>`. All commands run against the current working directory; the chain config is loaded from `./.flume/chain.ts`. Top-level `flume --help` lists the subcommands, `flume --version` prints the package version, and `flume <subcommand> --help` prints per-command usage with exit codes.

Flume is exec-local: a bay declares `@dtmd/flume` as a dev dependency and invokes it through the package manager (`pnpm exec flume`, an npm script, `npx flume`). The binary that runs is the bay's own pinned copy, resolved the same way as every other dependency — global installs are unsupported, and the engine makes no attempt to detect or accommodate one.

## Global `--job <name>` / `FLUME_JOB`

`flume --job <name> <subcommand>` (the flag composes with every subcommand, at any argument position) resolves both `FLUME_DIR` and `FLUME_CONFIG_DIR` to `<repoRoot>/.flume/jobs/<name>` and sets `FLUME_JOB=<name>` — all three canonicalized and written back into the environment at CLI entry, so loop-spawned tick children inherit the resolution via env rather than flags. Setting `FLUME_JOB=<name>` directly (no flag) is honored identically.

The flag is a strict resolution authority: passing `--job` while `FLUME_DIR` or `FLUME_CONFIG_DIR` is explicitly set is a usage error (exit `2`). The env-var form composes instead of conflicting — on the loop → tick boundary the child inherits all three written-back vars, and the dir vars *are* the parent's canonical job resolution, so explicitly-set dirs win and the job name rides along.

The engine has no opinion on which branch a job runs on: the mutating subcommands (`tick`, `loop`) commit to whatever branch the working tree's HEAD is on, job-resolved or not — there is no dedicated `job/<name>` branch to assert or check out. Run on whatever branch you want the record on.

```sh
flume --job docs-refresh status        # reads .flume/jobs/docs-refresh/awake/
flume --job docs-refresh loop          # commits land on whatever branch HEAD is on
FLUME_JOB=docs-refresh flume tick      # identical resolution via env
```

## `flume status`

Prints baton state: the list of awake phases (or `hibernating` if none) read from `.flume/awake/`; then, when `.flume/loop.pid` exists, supervisor liveness (`supervisor pid N live`, or `loop.pid present, process dead — stale`; no pidfile prints nothing extra); then, when HEAD names a ref and a tip claim exists for it (RELEASE-v0.11 §4), that claim's holder (`tip claimed by pid N`, or `tip claim present, process dead — stale`; a detached HEAD or no claim file prints nothing extra); then the pending entry count read from `.flume/plan/pending.json` (`pending: N`; `pending: 0` when the file is absent; `pending: unparsable` when it exists but fails to parse); then, best-effort, chain-derived lines — a friction count when `Chain.friction` is declared and its dir holds notes, and one line per pending entry gated on a capability the chain hasn't asserted (a broken or missing chain withholds only these, never the lines above it). Observational only — nothing on disk changes. Exit code is `0` regardless of state; status is the right call to bake into shell prompts or watch loops without risk of side effects.

```sh
flume status
# awake: plan
# tip claimed by pid 4821
# pending: 3
```

## `flume tick`

Runs one phase × one agent invocation. Loads `.flume/chain.ts`, selects whichever phase is awake (singleton phases run once; fanout phases dispatch one pending entry per worktree in a single wave), invokes the agent, and applies the phase's after-commit and after-merge gates. A gate failure reverts the offending commit; the entry stays in pending for the next tick. Side effects: zero or more commits on the current branch, possible worktree creation under `.flume/worktrees/`, session capture under `.flume/sessions/`, and baton edits under `.flume/awake/` when a phase hands off or hibernates. Exits `0` on success or when no phase is awake; exits `69` (`EX_MOUNT_DEAD`) when the chain fails to load — the mount-dead class (v0.7 §4): no agent ran, nothing here is retryable by waiting; exits `1` on other harness error (unexpected exception), or when HEAD is detached (RELEASE-v0.11 §4: a tick's meaning is advancing a named tip; checkout a branch first) — a bare tick takes no tip claim itself (that's loop-level only, below) but still refuses on a detached HEAD so the behavior matches whether or not a loop wraps it.

Before committing, the tick re-reads the tip it started on (RELEASE-v0.11 §5). Unchanged → commits as usual. Moved — a human committed mid-tick, a pull landed, a claim-less bare tick collided with another writer — → **no commit**: the agent's output is left on disk untouched, the entry stays pending, and the printed summary reads `no commit (tip-moved)` in place of the usual `shipped <tags>`/`committed <sha>`. Exit code stays `0` — a tip-moved tick is a settled no-op from `tick`'s own perspective, the same as any other tick that produced no commit; `flume loop` is what treats a tip-moved tick as a run-level fact (below).

```sh
flume tick
```

## `flume loop [--max N]`

Repeatedly invokes the tick logic until the baton hibernates (no phase awake) or `--max` ticks have elapsed. `--max` defaults to `50` and exists as a safety cap so a runaway chain doesn't loop forever in CI or unattended runs. Each iteration has the same side effects as `flume tick`. A child tick that exits `69` (`EX_MOUNT_DEAD`, chain failed to load) halts the run immediately instead of burning the remaining ticks against the same failure, and the loop propagates that same exit code. Otherwise (v0.7 §4, amended): exits `0` on hibernation, on hitting the `--max` cap, or on partial success (some entries shipped despite other ticks erroring); exits `1` iff at least one tick errored **and** the run shipped nothing. Any errored ticks are named in the completion summary regardless of exit code — a partial-success `0` exit never hides them silently. This is the standard autonomous-run entry point — wire it into a long-running shell, a `tmux` pane, or a scheduler.

Before the first tick, `loop` refuses (exit `1`) on a detached HEAD, then acquires the advisory tip claim (RELEASE-v0.11 §4: one flume writer per tip) for the ref HEAD resolves to — exclusive-create at `<git-common-dir>/flume/tip-claims/<ref path>`, visible from every linked worktree sharing that `.git`. A live holder refuses (exit `1`, naming the holder's pid and claim path); a stale claim (holder process dead) is reclaimed silently and the loop proceeds. The claim is released on normal exit, `SIGINT`, and `SIGTERM`. It stands beside, not instead of, the `loop.pid` state-root lock above — the two guard different resources (a ref vs. a state root). A tick that hits the RELEASE-v0.11 §5 tip-moved outcome (see `flume tick`, above) counts as an errored tick for this command's own exit-code and summary accounting, same as a gate-revert: the run keeps going, but a run that ships nothing while hitting tip-moved exits `1`, and the tick is named in the completion summary regardless.

```sh
flume loop --max 20
```

## `flume wake <phase>`

Marks the named phase awake by touching `.flume/awake/<phase>`. The next `flume tick` (or `flume loop`) will schedule that phase. No chain is loaded and the phase name is not validated against the chain — `wake` is a pure filesystem flag operation, so a typo silently creates a stray flag file that no phase claims. Exits `0` on success; exits `2` if the `<phase>` argument is missing.

```sh
flume wake plan
```

## `flume sleep <phase>`

Removes `.flume/awake/<phase>`, taking the named phase out of the awake set. No-op if the flag file is already absent; the chain is not consulted. Use this to force-hibernate a phase mid-run, e.g. to pause an autonomous loop while inspecting state. Exits `0` on success (including the no-op case); exits `2` if `<phase>` is missing.

```sh
flume sleep plan
```

## `flume job new <name>`

Creates a job — state root `.flume/jobs/<name>/` on the current HEAD, whatever branch that is. Loads the repo chain (`<configDir>/chain.ts` — repo-resident, never job-local) and copies its declared `Chain.seedDir`, if any, into the state root verbatim, skip-existing: a re-run fills gaps (a stub added to the seed dir reaches jobs already created) and never clobbers a worked file. No `seedDir` declared → a bare job, no warning — state accretes from ticks, and bare is legitimate. Machinery only: no presets, no harness content baked into the CLI — that is the chain's to declare (see [`docs/CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md)). No branch is created or checked out. The job name must be a single path segment; a name containing a path separator is rejected before any directory is constructed.

Every run (idempotent) also:

- **Requires the repo chain to exist.** No chain at `<configDir>/chain.ts` is a usage error — a job that could never `run` must not be creatable. A declared-but-absent `seedDir` is the same class of error, checked before the state root is touched.
- **Merges the runtime ignore entries** into the job dir's `.gitignore` — `awake/`, `prior-attempts/`, `worktrees/`, `node_modules/`, `loop.pid` — creating the file if absent and preserving any lines the seed carried. The runtime owns its layout; chain-convention dirs (e.g. `sessions/`) are the chain's to declare in its `seedDir`.
- **Pins `core.longpaths true`** repo-locally on Windows.
- **Baseline-commits the seeded harness** (`git add .flume/jobs/<name>` — the ignore entries keep runtime state out of the commit) on the current HEAD, so subsequent plan/build ticks produce clean deltas. A re-run with nothing changed commits nothing.

Leaves HEAD untouched — tune the state, then run the job. Exits `0` on success; `1` on git or filesystem failure; `2` on usage errors (missing or unknown verb, missing `<name>`, a `<name>` that is not a single segment, no chain at `<configDir>/chain.ts`, or a declared `seedDir` absent on disk).

```sh
flume job new docs-refresh            # seeds from the repo chain's Chain.seedDir, if declared
flume job new scratch                 # no seedDir declared: bare job, no warning
```

## `flume job run <name> [--max N]`

Runs a job. Two steps, the first a preflight:

1. **Wake the entry phase iff the baton is hibernating.** The entry phase is `chain.phases[0]` — a content-free convention, no hardcoded phase names. A non-hibernating baton is left untouched, so an interrupted job resumes mid-flight instead of being restarted from the top. No branch assertion — the engine has no opinion on which branch a state root runs on.
2. **Run the standard loop under the job resolution.** From here this is exactly `flume --job <name> loop [--max N]`, on whatever branch HEAD is on: same `loop.pid` lock in the job state root, same one-child-process-per-tick supervisor, same exit codes.

Exits `0` on hibernation, when `--max` (default 50) is hit, or on partial success (some entries shipped despite other ticks erroring); `1` on git or harness failure, while another live loop holds the job's lock, or when at least one tick errored **and** the run shipped nothing (v0.7 §4, amended); `2` on usage errors (missing `<name>`); `69` (`EX_MOUNT_DEAD`) when a child tick's chain fails to load — halts the run immediately rather than continuing; `78` when a child tick reports terminal misconfiguration (see `flume tick`). Any errored ticks are named in the completion summary regardless of exit code.

```sh
flume job new docs-refresh
flume job run docs-refresh --max 20
```

## `flume job rm <name>`

Throw the harness away, keep the work. Four steps:

1. **Refuse while the job's `loop.pid` records a live pid** (exit `1`) — removing the state root out from under a running supervisor would strand its ticks. Stop the loop first; a stale pidfile (dead pid) is reclaimed silently.
2. **`git rm -r .flume/jobs/<name>` + cleanup commit on the current HEAD.** The commit is pathspec-scoped to the job dir, so unrelated staged work stays in the index. No branch is checked out or touched.
3. **Remove untracked runtime remnants** — `awake/`, `prior-attempts/`, pid files, and any leftover `node_modules/` (a stale engine link from a job dir created before the exec-local doctrine, if present): the ignore entries kept them out of git, so `git rm` left them behind.
4. **`git worktree prune`** — clears metadata left by the job's fanout worktrees.

The commits the job caused — including this cleanup commit — stay exactly where they landed, on whatever branch the job ran on. Integrating or discarding that history is an ordinary git operation, the operator's to run; see [`docs/MIGRATING-0.11.md`](MIGRATING-0.11.md) for the recipe when a job's work needs to move onto a clean branch first.

Exits `0` on success (re-running on an already-clean job is a no-op); `1` on a live loop or a git/filesystem failure; `2` on usage errors (missing `<name>`, or a `<name>` whose job dir does not exist).

```sh
flume job rm docs-refresh
```

## `flume job status`

Enumerates `.flume/jobs/*` in the working tree — one line per job, sorted by name, with the job's awake phases (or `hibernating`) and its pending count. The awake set is the job's own baton (`<jobdir>/awake/`); the pending count is the number of entries in `<jobdir>/plan/pending.json` — `0` when the file is absent (nothing planned is nothing pending), `unparsable` when it exists but does not parse, so one broken plan never hides the others. Non-directories under `jobs/` are skipped; prints `no jobs` when the dir is empty or missing.

Observational, like `flume status`: nothing on disk changes — no chain load, no baton dirs materialized — so it is safe to bake into prompts and watch loops. Note it reads the working tree's checkout: a job dir that lives only on a branch other than the one checked out will not appear. Exits `0` always (including `no jobs`); `2` if given any argument; `1` on a filesystem failure.

```sh
flume job status
# docs-refresh  awake: build  pending: 3
# scratch       hibernating   pending: 0
```
