# Flume CLI

`flume <subcommand>`. All commands run against the current working directory; the chain config is loaded from `./.flume/chain.ts`. Top-level `flume --help` lists the subcommands, `flume --version` prints the package version, and `flume <subcommand> --help` prints per-command usage with exit codes.

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
