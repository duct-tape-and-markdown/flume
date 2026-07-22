# Flume CLI

`flume <subcommand>`. All commands run against the current working directory; the chain config is loaded from `./.flume/chain.ts`. Top-level `flume --help` lists the subcommands, `flume --version` prints the package version, and `flume <subcommand> --help` prints per-command usage with exit codes.

## Global `--job <name>` / `FLUME_JOB`

`flume --job <name> <subcommand>` (the flag composes with every subcommand, at any argument position) resolves both `FLUME_DIR` and `FLUME_CONFIG_DIR` to `<repoRoot>/.flume/jobs/<name>` and sets `FLUME_JOB=<name>` — all three canonicalized and written back into the environment at CLI entry, so loop-spawned tick children inherit the resolution via env rather than flags. Setting `FLUME_JOB=<name>` directly (no flag) is honored identically.

The flag is a strict resolution authority: passing `--job` while `FLUME_DIR` or `FLUME_CONFIG_DIR` is explicitly set is a usage error (exit `2`). The env-var form composes instead of conflicting — on the loop → tick boundary the child inherits all three written-back vars, and the dir vars *are* the parent's canonical job resolution, so explicitly-set dirs win and the job name rides along.

**Wrong-branch guard.** Under a job resolution, the mutating subcommands (`tick`, `loop`) commit to the working tree's HEAD, so before dispatch they assert `HEAD == job/<name>` and refuse otherwise (exit `1`, naming both branches). Read-only subcommands (`status`, `render`, `wake`, `sleep`) skip the check. Bare invocation — no flag, no `FLUME_JOB` — leaves the HEAD-is-truth contract untouched: commits land on whatever branch is checked out.

```sh
flume --job docs-refresh status        # reads .flume/jobs/docs-refresh/awake/
flume --job docs-refresh loop          # requires HEAD == job/docs-refresh
FLUME_JOB=docs-refresh flume tick      # identical resolution via env
```

## `flume status`

Prints baton state: the list of awake phases (or `hibernating` if none) read from `.flume/awake/`. Observational only — no chain is loaded, no agent is invoked, nothing on disk changes. Exit code is `0` regardless of the awake set; status is the right call to bake into shell prompts or watch loops without risk of side effects.

```sh
flume status
# awake: plan
```

## `flume tick`

Runs one phase × one agent invocation. Loads `.flume/chain.ts`, selects whichever phase is awake (singleton phases run once; fanout phases dispatch one pending entry per worktree in a single wave), invokes the agent, and applies the phase's after-commit and after-merge gates. A gate failure reverts the offending commit; the entry stays in pending for the next tick. Side effects: zero or more commits on the current branch, possible worktree creation under `.flume/worktrees/`, session capture under `.flume/sessions/`, and baton edits under `.flume/awake/` when a phase hands off or hibernates. Exits `0` on success or when no phase is awake; exits `1` on harness error (chain load failure, unexpected exception).

```sh
flume tick
```

## `flume loop [--max N]`

Repeatedly invokes the tick logic until the baton hibernates (no phase awake) or `--max` ticks have elapsed. `--max` defaults to `50` and exists as a safety cap so a runaway chain doesn't loop forever in CI or unattended runs. Each iteration has the same side effects as `flume tick`. Exits `0` on hibernation or when the cap is hit; exits `1` on harness error. This is the standard autonomous-run entry point — wire it into a long-running shell, a `tmux` pane, or a scheduler.

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

## `flume render <phase> [--entry <tag>]`

Loads `.flume/chain.ts` and prints the rendered prompt for the named phase to stdout, without invoking the agent. For singleton phases the prompt is rendered from a tick context with the current `pending.json`. For fanout phases `render` selects the first entry whose gate is `open`, or — if `--entry <tag>` is given — the entry with that tag, so authors can preview the exact prompt a worktree run would receive. No commits, no baton edits, no agent calls; this is a dry-run inspection helper for iterating on `.flume/prompts/*.md` and `Phase.promptArgs`. Exits `0` on success; exits `2` if `<phase>` is missing or unknown, or if `--entry <tag>` matches no pending entry.

```sh
flume render plan
flume render build --entry DOCS-CLI
```

## `flume job new <name> [--template <dir>]`

Creates a job — branch `job/<name>` plus state root `.flume/jobs/<name>/`, both named by convention — from the current HEAD. If the branch already exists it is reused (checked out) rather than recreated. The job dir is seeded from `--template` by verbatim recursive copy; with no template it is created empty and a warning reminds you to populate it (chain.ts, prompts) before `flume job run`. Machinery only: no presets, no harness content — that is the template's to carry. The job name must be a single path/branch segment; a name containing a path separator is rejected before any directory or branch is constructed.

Every run (idempotent) also:

- **Merges the runtime ignore entries** into the job dir's `.gitignore` — `awake/`, `prior-attempts/`, `worktrees/`, `node_modules/`, `loop.pid` — creating the file if absent and preserving template-authored lines. The runtime owns its layout; chain-convention dirs (e.g. `sessions/`) are the template's to declare.
- **Links `node_modules/@dtmd/flume`** inside the job dir (junction on Windows, symlink elsewhere) to the running flume's own package root, so the chain resolves the exact flume that ticks it even when the repo declares another version. Skipped if the link already exists; a non-link squatting on that path is an error.
- **Pins `core.longpaths true`** repo-locally on Windows.
- **Baseline-commits the seeded harness** (`git add .flume/jobs/<name>` — the ignore entries keep runtime state and the link out of the commit), so subsequent plan/build ticks produce clean deltas. A re-run with nothing changed commits nothing.

Stays on `job/<name>` when done — tune the harness, then run the job. Exits `0` on success; `1` on git or filesystem failure; `2` on usage errors (missing or unknown verb, missing `<name>`, a `<name>` that is not a single segment, or `--template` pointing at no directory).

```sh
flume job new docs-refresh --template ../templates/docs-effort
flume job new scratch                 # empty; warns to populate before run
```

## `flume job run <name> [--max N]`

Runs a job. Three steps, the first two a preflight:

1. **Assert-or-checkout `job/<name>`.** The branch must exist (error if not — create the job with `flume job new` first); it is checked out unless HEAD is already on it. Inside a linked worktree that already holds `job/<name>` (the concurrency recipe: `git worktree add .git/flume-jobs/<name> job/<name>`, then run from inside it) the assert passes and no checkout runs.
2. **Wake the entry phase iff the baton is hibernating.** The entry phase is `chain.phases[0]` — a content-free convention, no hardcoded phase names. A non-hibernating baton is left untouched, so an interrupted job resumes mid-flight instead of being restarted from the top.
3. **Run the standard loop under the job resolution.** From here this is exactly `flume --job <name> loop [--max N]`: same `loop.pid` lock in the job state root, same one-child-process-per-tick supervisor, same exit codes.

Exits `0` on hibernation or when `--max` (default 50) is hit; `1` on git or harness failure, or while another live loop holds the job's lock; `2` on usage errors (missing `<name>`, or the job branch does not exist); `78` when a child tick reports terminal misconfiguration (see `flume tick`).

```sh
flume job new docs-refresh --template ../templates/docs-effort
flume job run docs-refresh --max 20
```
