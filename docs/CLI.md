# Flume CLI

> **Current reference.** Describes flume as it ships now; every spec cite
> names a live `spec/*.md` section.

`flume <subcommand>`. All commands run against the current working directory; the chain config is loaded from `./.flume/chain.ts`. Top-level `flume --help` lists the subcommands — as does the bare verb `flume help`, the same answer to the byte — `flume --version` prints the package version, and `flume <subcommand> --help` prints per-command usage with exit codes. A trailing name is that subcommand's page whichever spelling carried it — `flume help <subcommand>`, `flume --help <subcommand>` and `flume -h <subcommand>` alike, `flume help job` being the job verb's own; a name with no page refuses usage-shaped (exit `2`) naming it and echoing the spelling typed, rather than dropping the argument and answering the top-level listing.

Flume is exec-local: a bay declares `@dtmd/flume` as a dev dependency and invokes it through the package manager (`pnpm exec flume`, an npm script, `npx flume`). The binary that runs is the bay's own pinned copy, resolved the same way as every other dependency — global installs are unsupported, and the engine makes no attempt to detect or accommodate one.

The package ships a second bin, `flume-harness`, carrying the harness package's own verbs — the ones the engine's deliberately closed verb set does not offer. Its contracts are at the foot of this page, in the same form as the engine's.

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

Prints baton state: the list of awake phases (or `hibernating` if none) read from `.flume/awake/`; then, when `.flume/loop.pid` exists, supervisor liveness (`supervisor pid N live`, or `loop.pid present, process dead — stale`; no pidfile prints nothing extra); then, when HEAD names a ref and a tip claim exists for it (`spec/loop.md`, "The loop lock and the tip claim"), that claim's holder (`tip claimed by pid N`, or `tip claim present, process dead — stale`; a detached HEAD or no claim file prints nothing extra); then the pending entry count read from `.flume/plan/pending.json` (`pending: N`; `pending: 0` when the file is absent; `pending: unparsable` when it exists but fails to parse); then, behind a best-effort chain load, chain-derived lines — a friction count when `Chain.friction` is declared and its dir holds notes, and one line per pending entry gated on a capability the chain hasn't asserted; then, last, when a supervisor is live, what that run has spent on agents so far (`agent usage this run: <phase> ×N (turns, duration, tokens, cost)`, one entry per phase whose ticks invoked an agent at or after the instant `.flume/loop.pid` states the run took the lock, summed from the usage rows those ticks wrote to `.flume/tick-verdicts.jsonl` — the same totals `flume loop` prints when the run ends, read without ending it). No live supervisor prints nothing extra, and so does a live run whose ticks have invoked no agent yet: a phase that spent nothing is absent rather than listed at zero. A lock that states no instant — written by a flume before `0.17` — bounds no window, so the line is withheld and the reason goes to stderr rather than every previous run's spend being folded into this one's. A missing or broken chain can never fail status and withholds nothing above that line: it withholds those two, leaves the pending count reading the default `.flume/plan/pending.json` even where the chain declares another `Chain.pendingPath`, and says so twice. Once as a row of this listing — `chain: failed to load — <reason>`, printed on stdout with every other line and ahead of the count it explains, so a status over a chain that did not load never has the shape of a healthy one. Once on stderr, where the load names the failure, what it cost, and the refusals that bound it (`flume tick` and `flume check` exit non-zero on this same load). Degraded, never silent: a prompt or watch loop parsing the stdout listing reads that extra row, not a count with nothing to say it had been rebased. Observational only — nothing on disk changes. Exit code is `0` regardless of state; status is the right call to bake into shell prompts or watch loops without risk of side effects.

```sh
flume status
# awake: plan
# tip claimed by pid 4821
# pending: 3
```

## `flume tick`

Runs one phase × one agent invocation. Loads `.flume/chain.ts`, selects whichever phase is awake (singleton phases run once; fanout phases dispatch one pending entry per worktree in a single wave), invokes the agent, and applies the phase's after-commit and after-merge gates. A gate failure reverts the offending commit; the entry stays in pending for the next tick. Side effects: zero or more commits on the current branch, possible worktree creation under `.flume/worktrees/`, session capture under `.flume/sessions/`, and baton edits under `.flume/awake/` when a phase hands off or hibernates. Exits `0` on success or when no phase is awake; exits `2` on usage — a stray trailing positional (`tick` consumes none: running something other than whichever phase is awake is refused, not honored), or a chain load that failed the CJS-context refusal (the host repo's `package.json`, or the one beside `.flume/chain.ts`, lacks `"type": "module"`) — both nameable fixes, which is why they land here rather than in the mount-dead class; exits `69` (`EX_MOUNT_DEAD`) when the chain fails to load for any other reason — the mount-dead class (`spec/loop.md`, "Exit codes — the run never lies to CI"): no agent ran, nothing here is retryable by waiting; exits `78` (`EX_CONFIG`) on terminal misconfiguration — a chain that resolved but declares an inconsistent world, today every awake flag naming a phase it does not declare, with the flags left on disk to inspect; exits `1` on other harness error (unexpected exception), or when HEAD is detached (a tick's meaning is advancing a named tip; checkout a branch first) — a bare tick takes no tip claim itself (that's loop-level only, below) but still refuses on a detached HEAD so the behavior matches whether or not a loop wraps it.

Before each cherry-pick onto the current branch, the tick asks whether another process holds a live claim on this tip (`spec/loop.md`, "Tip verify — one writer per branch, absorption at the merge") — never whether the tip still matches a sha recorded at tick start. No live foreign claim → whatever moved the ref was not an engine, so the span picks onto whatever tip is current and an operator's mid-tick commit is absorbed under it; git's own conflict detection arbitrates content (a conflicting pick aborts and that entry stays pending), and the phase's after-merge gates validate the merged tree. A live claim held by another process — a second engine interleaving merges onto one ref — → **no commit** for every entry not already merged: the agent's output is left on disk untouched, the entry stays pending, and the printed summary reads `no commit (tip-moved)` in place of the usual `shipped <tags>`/`committed <sha>`. The agent's own commits are checked separately and before any gate, by ancestry against the base its worktree branched from: a base that is no longer an ancestor of what the agent left is refused the same way, naming both shas. Exit code stays `0` — a tip-moved tick is a settled no-op from `tick`'s own perspective, the same as any other tick that produced no commit; `flume loop` is what treats a tip-moved tick as a run-level fact (below).

```sh
flume tick
```

## `flume loop [--max N]`

Repeatedly invokes the tick logic until the baton hibernates (no phase awake) or `--max` ticks have elapsed. `--max` defaults to `50` and exists as a safety cap so a runaway chain doesn't loop forever in CI or unattended runs. Each iteration has the same side effects as `flume tick`. A child tick that exits `69` (`EX_MOUNT_DEAD`, chain failed to load) or exits `78` (`EX_CONFIG`, terminal misconfiguration) halts the run immediately instead of burning the remaining ticks against the same wall, and the loop propagates that same code — exiting `0` there would re-mask either as clean at the next process boundary up. Otherwise (`spec/loop.md`, "Exit codes — the run never lies to CI"): exits `0` on hibernation, on hitting the `--max` cap, or on partial success (some entries shipped despite other ticks erroring); exits `1` when at least one tick errored **and** the run shipped nothing, and when the consecutive-failure backstop aborted the run — an identical provision-stage, merge-stage or gate-stage failure signature on as many consecutive ticks as the chain's `supervisorPolicy.abortThreshold` declares, with no successful tick between them. A graceful stop mid-run (`.flume/stop` written while the loop is already going) ends iteration after the in-flight tick finishes but never changes the code — it stays decided by the run's totals either way. Any errored ticks are named in the completion summary regardless of exit code — a partial-success `0` exit never hides them silently. This is the standard autonomous-run entry point — wire it into a long-running shell, a `tmux` pane, or a scheduler.

Arguments are checked before anything runs: `loop` exits `2` on a `--max` value that is missing, non-numeric or negative, and on a stray positional past `--max <value>` — it consumes none, so running something other than what was typed is refused rather than silently started. The stop flag is read next (`spec/loop.md`, "Graceful stop"): a `.flume/stop` already present refuses with exit `1` — remove it to acknowledge the stop before starting a new run — and a flag that exists but cannot be stat'd exits `74` (`EX_IOERR`) naming the underlying error, rather than starting the run, because an unreadable flag is not an absent one (`.claude/rules/engineering.md`, "Loud or nothing").

Before the first tick, `loop` refuses (exit `1`) on a detached HEAD, then acquires the advisory tip claim (`spec/loop.md`, "The loop lock and the tip claim": one flume writer per tip) for the ref HEAD resolves to — exclusive-create at `<git-common-dir>/flume/tip-claims/<ref path>`, visible from every linked worktree sharing that `.git`. A live holder refuses (exit `1`, naming the holder's pid and claim path); a stale claim (holder process dead) is reclaimed silently and the loop proceeds. The claim is released on normal exit, `SIGINT`, and `SIGTERM`. It stands beside, not instead of, the `loop.pid` state-root lock above — the two guard different resources (a ref vs. a state root). Both files carry the same two lines: the holder's pid first, the ISO-8601 instant it took the guard second. Every liveness reader takes the first line, so a reader after "who holds this" looks where it always has; the second is what `flume status` bounds the live run's agent spend by, in place of the lock file's mtime. A file written by flume before `0.17` states only the pid, and still names its holder — but a flume before `0.17` reads a two-line file as no pid at all and reclaims the guard out from under a live run, so a state root or a `.git` reachable by two versions is upgraded in one go ([`MIGRATING-0.17.md`](MIGRATING-0.17.md)). A tick that hits the tip-moved outcome (see `flume tick`, above) counts as an errored tick for this command's own exit-code and summary accounting, same as a gate-revert: the run keeps going, but a run that ships nothing while hitting tip-moved exits `1`, and the tick is named in the completion summary regardless.

Under that claim, and before the ignore merge and the startup sweep, `loop` reads the interrupted-merge markers (`spec/loop.md`, "Crash equals stop"): a `.flume/merging/` dir that exists but cannot be listed exits `74`, since whether a marker stands behind it is then unknown; a marker that *is* standing — a merge that died between the cherry-pick and the queue rewrite, so the picked commit may sit on trunk ungated with its entry still open — exits `78`, naming the file, the branch and the entry. Nothing is touched and the startup sweep does not run, so each branch named survives for reconciliation; removing the marker is the acknowledgement, as with the stop flag.

```sh
flume loop --max 20
```

## `flume wake <phase>`

Marks the named phase awake by touching `.flume/awake/<phase>`. The next `flume tick` (or `flume loop`) will schedule that phase. The phase name is validated against the repo chain's declared phases behind the same best-effort load `flume status` takes: a chain that loads and does not declare `<phase>` refuses with exit `2` before the flag is written, while a missing or broken chain never blocks the flag — it reports the failure and what it cost (nothing checked the phase name, so a typo lands a marker no phase will ever read) on stderr, never silently. `--job` does not retarget the load; the chain is repo-resident. Exits `0` on success; exits `2` if the `<phase>` argument is missing, if an extra positional follows it, or on an undeclared phase.

```sh
flume wake plan
```

## `flume sleep <phase>`

Removes `.flume/awake/<phase>`, taking the named phase out of the awake set. No-op if the flag file is already absent. The phase name is validated exactly as `wake` validates it, through the same best-effort chain load and with the same stderr report on a chain that fails to load. Use this to force-hibernate a phase mid-run, e.g. to pause an autonomous loop while inspecting state. Exits `0` on success (including the no-op case); exits `2` if `<phase>` is missing, if an extra positional follows it, or on an undeclared phase.

```sh
flume sleep plan
```

## `flume stop`

Writes `.flume/stop` and prints what happens next: with a live supervisor, that it
finishes its in-flight tick and ends the run; otherwise, that the next `loop` /
`job run` refuses to start until the flag is removed. Idempotent — running it again
while the flag is already present rewrites the same empty file and prints the same
statement. The verb is discoverability, not a privileged channel: `touch .flume/stop`
is equally the interface, and nothing distinguishes the two writers. There is
deliberately no `unstop` / `resume` verb — removing the flag is the operator's own
acknowledgement that they saw the stop, and an engine verb that removed it would let
a script ack a stop no human saw. Consumes no positionals; a trailing argument is
refused before the flag is written. Exits `0` always; `2` if given any argument.

```sh
flume stop
# [flume] wrote .flume/stop: a live supervisor finishes its in-flight tick and
# ends the run; the next `loop`/`job run` refuses to start until the flag is
# removed.
```

## `flume job new <name>`

Creates a job — state root `.flume/jobs/<name>/` on the current HEAD, whatever branch that is. Loads the repo chain (`<configDir>/chain.ts` — repo-resident, never job-local) and copies its declared `Chain.seedDir`, if any, into the state root verbatim, skip-existing: a re-run fills gaps (a stub added to the seed dir reaches jobs already created) and never clobbers a worked file. No `seedDir` declared → a bare job, no warning — state accretes from ticks, and bare is legitimate. Machinery only: no presets, no harness content baked into the CLI — that is the chain's to declare (see [`docs/CHAIN-AUTHORING.md`](CHAIN-AUTHORING.md)). No branch is created or checked out. The job name must be a single path segment; a name containing a path separator is rejected before any directory is constructed.

Every run (idempotent) also:

- **Requires the repo chain to exist.** No chain at `<configDir>/chain.ts` is a usage error — a job that could never `run` must not be creatable. A declared-but-absent `seedDir` is the same class of error, checked before the state root is touched.
- **Merges the runtime ignore entries** into the job dir's `.gitignore` — the runtime-owned set (`spec/jobs.md`, "Runtime ignores") — creating the file if absent and preserving any lines the seed carried. The runtime owns its layout, and only that; chain-convention dirs (e.g. `sessions/`) are the chain's to declare in its `seedDir`.
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

Exit codes are the loop's, against the job's state root: exits `0` on hibernation, when `--max` (default `50`) is hit, or on partial success (some entries shipped despite other ticks erroring); exits `1` on git or harness failure, while another live loop holds the job's lock, when the job's stop flag is already present, when at least one tick errored **and** the run shipped nothing, or when the consecutive-failure backstop aborted the run (`spec/loop.md`, "Exit codes — the run never lies to CI"); exits `2` on usage errors (missing `<name>`, a bad `--max` value, a stray positional); exits `69` (`EX_MOUNT_DEAD`) when a child tick's chain fails to load — halts the run immediately rather than continuing; exits `74` (`EX_IOERR`) when the job's stop flag or its merging-marker dir exists but cannot be read (see `flume loop`); exits `78` when a child tick reports terminal misconfiguration (see `flume tick`), or when an unreconciled `merging/<slug>.json` marker stands under the job dir at start. A graceful stop mid-run ends iteration after the in-flight tick but never changes the code. Any errored ticks are named in the completion summary regardless of exit code.

```sh
flume job new docs-refresh
flume job run docs-refresh --max 20
```

## `flume job rm <name>`

Throw the harness away, keep the work. Four steps:

1. **Refuse while the job's `loop.pid` records a live pid** (exit `1`) — removing the state root out from under a running supervisor would strand its ticks. Stop the loop first; a stale pidfile (dead pid) is reclaimed silently.
2. **`git rm -r .flume/jobs/<name>` + cleanup commit on the current HEAD.** The commit is pathspec-scoped to the job dir, so unrelated staged work stays in the index. No branch is checked out or touched.
3. **Remove untracked runtime remnants** — `awake/`, `prior-attempts/`, `rendered-prompts/`, pid files, and any leftover `node_modules/` (a stale engine link from a job dir created before the exec-local doctrine, if present): the ignore entries kept them out of git, so `git rm` left them behind.
4. **`git worktree prune`** — clears metadata left by the job's worktrees, a tick's own as much as a wave's.

The commits the job caused — including this cleanup commit — stay exactly where they landed, on whatever branch the job ran on. Integrating or discarding that history is an ordinary git operation, the operator's to run; see [`docs/MIGRATING-0.10.md`](MIGRATING-0.10.md) § 5 for the recipe when a job's work needs to move onto a clean branch first.

Exits `0` on success (re-running on an already-clean job is a no-op); `1` on a live loop or a git/filesystem failure; `2` on usage errors (missing `<name>`, or a `<name>` whose job dir does not exist).

```sh
flume job rm docs-refresh
```

## `flume job status`

Enumerates `.flume/jobs/*` in the working tree — one line per job, sorted by name, with the job's awake phases (or `hibernating`) and its pending count. The awake set is the job's own baton (`<jobdir>/awake/`) — `awake: unreadable` where that dir exists but cannot be read (a permission failure, a path too long for the platform), which is neither a phase list nor a hibernating baton and is never reported as one, and never aborts the enumeration for the sibling jobs; the pending count is the number of entries in `<jobdir>/plan/pending.json` — `0` when the file is absent (nothing planned is nothing pending), `unparsable` when it exists but does not parse, so one broken plan never hides the others. Non-directories under `jobs/` are skipped; prints `no jobs` when the dir is empty or missing — *missing*, never merely unreadable: a jobs dir that exists but cannot be read fails the verb (exit `1`) rather than reporting an empty repo.

Observational, like `flume status`: nothing on disk changes — no baton dirs materialized — so it is safe to bake into prompts and watch loops. It takes the same best-effort chain load `flume status` does, for the repo chain's declared `Chain.pendingPath` and `Chain.friction` (a job whose friction dir holds notes gets a trailing `friction: N note(s) await routing` column). A missing or broken chain never fails the verb: it withholds the friction column, leaves every job's pending count reading the default queue path, and reports the failure and what it cost on stderr, never silently. Note it reads the working tree's checkout: a job dir's tracked files (chain, prompts, `plan/pending.json`) are branch-scoped and will not appear on a branch that never committed them. Its gitignored subdirs — `awake/`, `loop.pid`, `prior-attempts/`, `rendered-prompts/`, `worktrees/` (`spec/jobs.md`, "Runtime ignores") — are untracked and outlive a branch switch, so a stale baton or `loop.pid` from a job dir seeded elsewhere can still surface after HEAD moves off that branch. Exits `0` always (including `no jobs`); `2` if given any argument; `1` on a filesystem failure.

```sh
flume job status
# docs-refresh  awake: build  pending: 3
# scratch       hibernating  pending: 0
# sealed        awake: unreadable  pending: 0
```

## `flume log [-n N] [--json]`

Observational; prints the last `N` tick verdicts (default `10`) from
`tick-verdicts.jsonl`, oldest first. The human form is one fixed-format line per
verdict carrying only fields the record already holds — phase, whether it committed,
gate results, shipped tags, merge outcomes: `<phase>  committed=<bool>
gates=[<gate>:ok|FAIL,...]  shipped=[<tag>,...]  merge=[<tag>:<outcome>,...]`.
`--json` emits the records verbatim as JSONL, one per line, for a supervising agent
to parse instead of scrape. Facts only, never reclassified — `log` prints what the
verdict record states and nothing derived; park/bail vocabulary belongs to the
chain, not to this verb. No verdicts file present prints nothing and exits `0`.
Mutates nothing. Exits `0` on success; `2` if `-n` is missing its value or
non-numeric, or given any other unrecognized argument.

```sh
flume log -n 3
# plan  committed=true  gates=[tsc:ok,vitest:ok]  shipped=[]  merge=[]
# build  committed=true  gates=[tsc:ok,vitest:ok]  shipped=[DOCS-CLI-1]  merge=[DOCS-CLI-1:merged]
# build  committed=false  gates=[tsc:FAIL]  shipped=[]  merge=[]

flume log --json
# {"phaseName":"build","committed":true,"gateResults":[...],"shippedTags":["DOCS-CLI-1"],"mergeOutcomes":[...]}
```

## `flume check`

Validates the working tree's `.flume/plan/pending.json` without spending an agent:
the real parse (the same decode a tick's resolution takes) plus fence arithmetic for
every entry — each entry's declared paths checked against the consumer fanout
phase's declared fence, the same computation the write guard enforces at commit
time. Read-only — touches no baton flag, loads the chain only to compute the fence,
and invokes nothing. Scope is deliberately the engine's own mechanics alone; chain
gates need a tick's `GateContext` and do not run here. No `pending.json` present
prints `plan/pending.json absent — nothing to check` and exits `0`. A chain that
declares no fanout phase has no consumer and therefore no fence: the parse still
runs, the fence step is skipped, and the output says `no fanout phase declared;
fence not checked` — vacuous by design and spelled out, never a refusal of every
declared path. Consumes no positionals. Exits `0` when the file parses and every
entry's paths clear the fence (and on either skip above); exits `65`
(`EX_DATAERR`) on a parse failure or a fence violation, naming the
offending entry and paths — the same refusal the next tick would otherwise have
spent an invocation to discover; exits `2` if given any argument, or `69`
(`EX_MOUNT_DEAD`) if the chain itself fails to load.

```sh
flume check
# plan/pending.json valid (3 entries), fence check passed

flume check
# [flume] check: 1 pending entry declares files outside the consumer phase's fence
#   [DOCS-CLI-1] src/forbidden.ts

flume check   # a chain with no fanout phase
# plan/pending.json valid (3 entries), no fanout phase declared; fence not checked
```

## `flume render <phase> [--entry <tag>]`

Prints to stdout the prompt a tick would hand `<phase>`, invoking nothing — the
other half of what `flume check` does for the queue. It runs the dispatcher's own
resolution path one call short of the agent: the same chain load, the same queue
read at HEAD, the same pickability verdict, the same fence in the `<harness>`
block, the same renderer. Nothing is re-derived beside the dispatcher — an earlier
verb that previewed its own approximation of the fence, the prior-attempt state
and pickability was removed for exactly that (`CHANGELOG`, 0.10.0).

Two things differ from a tick, because no tick is running. Inline-exec spans
evaluate in the primary checkout rather than a provisioned worktree — nothing is
created, so nothing needs tearing down. And the `<prior-attempt>` block is
omitted: a render outside a tick has no attempt to carry, it is never
reconstructed, and the **output's first line says so**, whether or not a record
stands on disk. `TickContext.priorAttempts` is still the real on-disk map, since
that one is a fact a `promptArgs` hook reads.

Under a fanout phase, `--entry <tag>` scopes the render to that queue entry —
pickable or not. A parked, blocked or capability-gated entry renders, and stderr
says a tick would not carry it; the verdict is reported, never spent as a refusal.
Omitted, the entry the next wave's first batch carries first is chosen by the
dispatcher's own batch arithmetic, and stderr names it. A singleton phase picks
from no queue, so `--entry` against one is a usage error.

There is no `--out`: stdout is the surface, and a tick's own record of what it
sent stays in `rendered-prompts/`. Read-only apart from the one filesystem effect
`flume status` also has — constructing the baton creates `<flumeDir>/awake/` when
absent. No baton flag is set, no worktree is provisioned, no `rendered-prompts/`
record is written, and no hook refusal is persisted.

Exits `0` once the prompt is on stdout; `2` on any usage-shaped refusal (missing
`<phase>`, a stray positional past it, `--entry` with no value, an unknown phase,
`--entry` against a phase that picks nothing, `--entry` naming no entry in the
queue at HEAD, a fanout phase with nothing pickable and no `--entry`, or the
CJS-context chain-load refusal); `65` (`EX_DATAERR`) when the prompt never
resolved — an inline-exec span that exited non-zero, named with its stderr, or a
`promptArgs` hook that threw, which is the same `render-refused` class a tick
would have spent an invocation to reach; `69` (`EX_MOUNT_DEAD`) when the chain
could not be brought up at all — it failed to load, the queue at HEAD failed to
parse, or the declared prompt file is not on disk.

```sh
flume render plan
# [flume] render: <prior-attempt> omitted — a render outside a tick carries no attempt, and it is never reconstructed.
# <harness>
# Phase: plan
# ...

flume render build --entry DOCS-CLI-1 > /tmp/preview.md
# [flume] render: build scoped to entry DOCS-CLI-1        (stderr)

flume render build --entry PARKED-ONE
# [flume] render: build scoped to entry PARKED-ONE — not pickable at HEAD; a tick would not carry it
```

## `flume friction [name]`

Bare, lists the declared friction channel's notes — filename, size in bytes, and
mtime as an ISO timestamp, one line per file, sorted by name. With `name`, prints
that note's bytes verbatim to stdout. Output is never interpreted — the engine's
lifecycle guarantee over the channel is interpretation-freedom, not read-freedom,
and this verb only moves bytes; it never derives meaning from them. `name` must name
a direct child of the declared directory — the same scope the bare list enumerates;
a nested or escaping path is refused, not resolved. A dot-prefixed name is not a
note: the bare list omits it, `name` refuses it as absent, and the `friction: N`
count on `flume status` and `flume job status` skips it — a `.gitkeep` git made
the consumer create for an otherwise-empty, gitignored channel dir is no work. The
skip is by name alone, never by content. A chain that declares no
`Chain.friction` refuses usage-shaped, naming the missing declaration. A declared but
not-yet-created directory lists empty and exits `0` — the directory is created
lazily by whichever engine write needs it first. Exits `0` on a successful list or
read (including the empty-directory case); `2` if the chain declares no
`Chain.friction`, if given more than one argument, or if `name` names no note in the
directory; `69` (`EX_MOUNT_DEAD`) if the chain fails to load; `74` (`EX_IOERR`) if
the channel dir, or a note in it, exists but cannot be read or stat'd — the named
read, the bare list's directory read, and the bare list's per-note stat all refuse
rather than report the note missing or the channel empty, and a refused list prints
no rows at all rather than a partial listing.

```sh
flume friction
# revert-note-a54de89.md  412  2026-09-06T14:02:11.000Z

flume friction revert-note-a54de89.md
# (bytes of the note, written verbatim to stdout)
```

## `flume-harness init`

A verb on the *other* bin. The harness package ships its own command line beside the engine's, so `flume`'s verb set stays closed and `src/` never imports the harness (`spec/harness.md`, *Adoption and upgrade*). It is the same npm package and the same version, so one install provides both — before the dependency is there, `npx --package @dtmd/flume flume-harness init`; once it is, `pnpm exec flume-harness init`. `flume-harness` with no verb, or with `-h` / `--help` anywhere on the command line — `flume-harness --help` and `flume-harness init --help` alike — prints the verb list and exits `0`, before anything is written.

`init` adopts the harness into the repository it is run in: the repository is the current working directory and the state root is `.flume`. The verb takes no arguments and no flags — no `--job`, no state-root selector; adopting into a different root is the exported `harnessInit({ repoRoot, stateRoot })`, a library call rather than a command line. Two steps, the first entirely a preflight:

1. **Resolve every input before the first byte.** The state root's absence (a stat failure that is not absence refuses rather than reading as "not adopted yet"), this package's own manifest for the version range to declare, the shipped `PROTOCOL.md` template, and the repository's `package.json` if it has one. Nothing on disk is touched until all of them pass: an init that stopped half-way would leave ignore lines for a state root that does not exist, or a `PROTOCOL.md` beside no declaration — a tree nothing refuses and no re-run can tell from a finished one.
2. **Write the adoption, then report it.** `.flume/package.json` (`"type": "module"` and nothing else — the module scope the two files beside it load in: flume is ESM-only, a chain loaded as CommonJS stops resolving it on node 22, and your own repository's manifest is untouched, so a CommonJS repo adopts and its chain still loads), `.flume/declaration.ts` (the skeleton whose `specLocus`, `fence` and `slices` are yours to fill in), `.flume/chain.ts` (the hop the engine loads — the same three lines in every adopting repository, and nothing in it yours to tune), `.flume/PROTOCOL.md`, and `.flume/plan/pending.json` holding an empty queue: nothing else creates one, and a plan slice refuses over an absent queue. Then the runtime ignore lines are *merged* into `.gitignore` — created if absent, and everything already in it kept — and `@dtmd/flume` is declared at `^<version>` in the manifest's `dependencies`. A range already declared (in either `dependencies` or `devDependencies`) is left exactly as it was: a pinned range is a decision, and overwriting it would be init choosing a version on your behalf. No installer is spawned and no lockfile is touched — which package manager reconciles `node_modules` stays yours, and the closing line says what to run next.

What init writes once it never rewrites. Upgrading is one version bump plus the release's migration note, never a re-run that reconciles a declaration someone has since edited — which is why the refusals below are refusals rather than merges.

Refusals, every one of them taken before anything is written: **a state root already there** (`.flume/` exists) — the repository has already adopted the package, and the message names the path and says to remove it to start over; **a `package.json` present but not readable as a manifest** — it is not JSON, it parses to something that is not an object, or it hangs a non-object off `dependencies` / `devDependencies`, each named by field, because spreading one of those shapes would rewrite the manifest into something never declared and report it as a dependency added; and **a shipped `PROTOCOL.md` template still carrying an unsubstituted `{{…}}` placeholder**, a packaging failure that would otherwise ship brace tokens into every adopter's prose. A repository with *no* `package.json` at all is not a refusal — init proceeds, writes nothing of its own, and reports the fact, which is bounded downstream: the declaration it just wrote imports `@dtmd/flume/harness`, so a first tick run without the package installed fails at module resolution naming the specifier rather than running on a default nobody chose.

Exit codes: `0` on a completed adoption, and on the help text — including `init --help`, which is answered above the argument refusal rather than tripping it; `64` (`EX_USAGE`) on a command line the bin cannot act on — an unknown verb, or `init` handed arguments it has none of — the caller's command line rather than the repository's state, which is the line `64` marks; `1` on a refusal over what is on disk (all three above) or any other error, with the message in flume's own voice on stderr.

```sh
npx --package @dtmd/flume flume-harness init
# flume-harness init — /home/you/repo
#
#   wrote     .flume/package.json
#   wrote     .flume/declaration.ts
#   wrote     .flume/chain.ts
#   wrote     .flume/PROTOCOL.md
#   wrote     .flume/plan/pending.json
#   ignores   .gitignore +10 line(s) under .flume/
#   depends   @dtmd/flume@^0.15.0 added to package.json
#
# Next: install the dependency, then edit .flume/declaration.ts — its
# `specLocus`, `fence` and `slices` are placeholders.

pnpm exec flume-harness init          # a repository that already adopted
# flume-harness init: /home/you/repo/.flume already exists — refusing to
# overwrite it. ...                                              (exit 1)
```
