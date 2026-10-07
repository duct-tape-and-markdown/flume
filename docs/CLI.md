# Flume CLI

> **Current reference.** Describes flume as it ships now; every spec cite
> names a live `spec/*.md` section.
>
> **Reading the exit codes.** These sections backtick values as well as codes,
> so every code carries its own introducing verb in the same clause — "exits
> `74`", "refuses (exit `2`)", "Exit code stays `0`", never a later code
> trailing a sibling under one leading "Exits" — and a backticked integer with
> no such verb beside it, like `--max`'s default, is a value rather than a
> code.

`flume <subcommand>`. All commands run against the current working directory; the chain config is loaded from `./.flume/chain.ts`. Top-level `flume --help` lists the subcommands — as does the bare verb `flume help`, the same answer to the byte — `flume --version` prints the package version, and `flume <subcommand> --help` prints per-command usage with exit codes. A trailing name is that subcommand's page whichever spelling carried it — `flume help <subcommand>`, `flume --help <subcommand>` and `flume -h <subcommand>` alike; a name with no page refuses usage-shaped (exit `2`) naming it and echoing the spelling typed, rather than dropping the argument and answering the top-level listing.

Flume is exec-local: a bay declares `@dtmd/flume` as a dev dependency and invokes it through the package manager (`pnpm exec flume`, an npm script, `npx flume`). The binary that runs is the bay's own pinned copy, resolved the same way as every other dependency — global installs are unsupported, and the engine makes no attempt to detect or accommodate one.

The package ships a second bin, `flume-harness`, carrying the harness package's own verbs — the ones the engine's deliberately closed verb set does not offer. Its contracts are at the foot of this page, in the same form as the engine's.

## State-root and config-dir resolution

Two independent roots, resolved once at CLI entry — ahead of verb dispatch, so every subcommand and every chain load in the process reads the same answer. **`FLUME_DIR`** relocates the mutable-state root (the baton under `awake/`, `plan/pending/`, worktrees, prior-attempt records, `loop.pid`); **`FLUME_CONFIG_DIR`** relocates the chain and prompts dir (`<configDir>/chain.ts`, and every `phase.promptPath` resolved against it). Both default to `<repoRoot>/.flume`, and a set-but-relative value resolves against the current working directory. Setting both to one directory co-locates config and state.

There is no third selector: one checkout resolves one state root, and a repository running several efforts at once gives each a checkout of its own (`git worktree add`, the operator's act). Nothing retargets the state root below the repository root but `FLUME_DIR` itself. That rule is enforced where the roots resolve rather than left to fail later: a resolved state root that is not the checkout's own, in a checkout whose bay already holds runtime state of its own — a standing baton flag, a worktree base with a worktree under it, a verdict log — refuses (exit `2`) naming both roots and the checkout, ahead of verb dispatch and before anything is provisioned. A bay holding only a chain and its prompts is that run's config dir and no second root, so relocating state alone while the chain stays put composes as it always has. So is a bay whose runtime names hold nothing: `flume sleep` over the last standing flag empties `awake/` without removing it, and a directory nothing stands in is not state it holds. Unrefused, the second root collided several steps on as git's own error over a branch the first root's tick held, in a vocabulary naming neither root.

Both resolved paths are canonicalized to absolute and written back into the environment, so a chain loaded later in the same process and every loop-spawned tick child read one resolved value instead of re-deriving the default. The write-back also stamps `FLUME_DIR_RESOLVED_FOR=<repoRoot>`: a later invocation that inherits an environment already carrying that stamp for a *different* repository refuses (exit `2`) rather than writing into the outer repository's control plane, naming both vars to clear. A `FLUME_DIR` typed fresh for the invocation carries no stamp and is never refused on that basis, whatever its path looks like.

```sh
FLUME_DIR=/var/lib/flume/state flume loop   # state out of the working tree
```

## Narration carries the instant it was written

Every line the CLI writes to the operator on stderr opens with the instant it was written, as an ISO-8601 UTC timestamp: the spelling the tick verdict, the claim files and the record filenames already carry, so a captured log lines up against every other artifact of the run. That is `flume loop`'s supervisor narration, the lines each tick child writes — and every verb's own refusal, whichever verb takes it: a usage line, an undeclared phase name, a chain that would not load, a read that would not resolve, a queue whose entries would not parse, a render that resolved nothing. A refusal is often the only line its run writes, and an unstamped one is the line an operator cannot place against anything else the run left.

A verb's own listing is not narration and carries no stamp: `flume status`'s rows, `flume log`'s history — `--json` included — `flume friction`'s notes and note bodies, `flume render`'s prompt, and what `wake`, `sleep`, `hold` and `stop` print for the marker they wrote all reach stdout exactly as they always have, so anything parsing a listing reads the bytes it always read. What the chain's own agent prints is untouched, and so is the engine's `consoleLogger`, which writes the line it was handed and nothing more — an embedder that routes a `Logger` of its own times its lines its own way.

A reader is free to stop reading, and that is not a failure of the verb that was writing. `flume status | head -1` closes the pipe as soon as it has its line; the remaining rows go nowhere, nothing is reported for the writes that failed, and the verb keeps the exit code it would have had with the reader still attached — zero for an observation it finished, and its own refusal code where it refuses partway through a listing, because what the reader did says nothing about what the verb found. The answer is at the CLI's own output point, armed ahead of the first byte any verb writes, so it is the same answer at every subcommand and for both streams — `2>&1 | head -1` closes one pipe carrying both. Only the reader going away is quieted: a write that fails on its own merits, a full disk under a redirected stdout, still ends the process loudly.

## `flume status`

Prints baton state: the list of awake phases (or `hibernating` if none) read from `.flume/awake/`; then, when any phase is held, the held phases on a line of their own (`held: <phase>, <phase>`, read from `.flume/held/`; nothing held prints nothing extra, and the two sets are named apart because neither implies the other — a hold outranks a flag and survives it being removed and re-stood); then, when `.flume/loop.pid` exists, supervisor liveness (`supervisor pid N live`, or `loop.pid present, process dead — stale`; no pidfile prints nothing extra); then, when `.flume/run-end.json` exists, how the last run that ended under this root ended — the reason and the instant that run recorded (`last run end: hibernation at <ISO-8601>`; a signalled end names the signal it took, and a run one of the supervisor's fail-fast walls ended names the child exit code it ended on) — except beside a stale `loop.pid`, where the line says the current run died without recording an end instead, because a death no handler runs on (`SIGKILL`, `TerminateProcess`) records nothing and the dead lock is what says so rather than an earlier run's record (`spec/loop.md`, "Crash equals stop"); a record that is there and will not parse prints as present but unreadable rather than as a root no run has ended under; then, when HEAD names a ref and a tip claim exists for it (`spec/loop.md`, "The loop lock and the tip claim"), that claim's holder and the state root the claim was taken for (`tip claimed by pid N for <state root>`, or `tip claim present, process dead — stale`; the root is the one the *claim* records, so a claim held for another root under the same checkout reads as that root's rather than as this one's, and a claim naming none — written before the claim's third line existed — reads `for a state root it did not state` rather than borrowing the root this process resolved; a detached HEAD or no claim file prints nothing extra); then the pending entry count read from `.flume/plan/pending/` (`pending: N`; `pending: 0` when the directory is absent or holds no entry; `pending: unparsable` when an entry file in it fails to parse); then, behind a best-effort chain load, chain-derived lines — a friction count when `Chain.friction` is declared and its dir holds notes, and one line per pending entry gated on a capability the chain hasn't asserted; then, last, when a supervisor is live, what that run has spent on agents so far and how many agents it has started whose spend that total does not yet carry (`agent usage this run: <phase> ×N (turns, duration, tokens, cost) — N agents started with no usage row yet, spend this total does not carry`, one entry per phase that invoked an agent at or after the instant `.flume/loop.pid` states the run took the lock — the same totals `flume loop` prints when the run ends, read without ending it). The rows are totalled wherever the run has written them: a tick that has settled wrote its rows to `.flume/tick-verdicts.jsonl` with its verdict, and a tick still running has them in `.flume/invocations/<phase>.jsonl`, one appended as each of its agents returns. So a wave four hours into its work is counted up to its last returned agent rather than reading as the last tick that finished, and the count that ends the line — one per prompt this run rendered that no row names yet — is what says how far behind the number is. It is a fact about the total and never a claim those agents are live: nothing the verb read states whether their processes are still running, so an agent killed mid-tick stays counted for as long as the run holds the lock. A row is counted once however many of those files hold it, and a rows file left by a tick that died before this run claimed the lock is another run's money and stays out. No live supervisor prints nothing extra, and so does a live run that has started no agent yet: a phase that spent nothing is absent rather than listed at zero, and a run none of whose agents has returned yet prints `agent usage this run: nothing returned yet` ahead of the count rather than withholding the line until one comes back. A lock that states no instant — written by a flume before `0.17` — bounds no window, so the line is withheld and the reason goes to stderr rather than every previous run's spend being folded into this one's. Then, just ahead of that last row, one line per goal the queue carries — `goal GOAL-TAG: work W-ONE, W-TWO; stood 2d 12h` — each naming the goal's remaining `work` entries and how long it has stood, in the order the queue serves them: a goal's place is the place of its earliest ready work under `Chain.order`, read through the one call site that applies that declaration for every other surface, so this listing cannot rank two goals differently from the tick that will pick between them. A goal is a root `group` — the shape an operator's goal is filed as (`spec/pending.md`, "The queue is a forest") — so a queue carrying none prints nothing here, and a goal nothing has been derived beneath yet reads `no work entry yet`. The work a row names is its whole subtree's rather than its direct children's, since an epic between a goal and its work is ordinary shape; a `step` beneath a work entry is part of that entry's own session rather than a queue entry of its own, so no row names one. A goal with nothing ready sorts behind every goal that has some and reads `nothing ready` where its position would be — a goal whose work is all parked, blocked, or gated on a capability the chain has not asserted, which is the gate switch's own verdict and the same one the flow row's waiting figure is taken over. Two reads can leave the served order untakeable, and `status` exits 0 over both: the filing read that order's own default and the chain's context are drawn from, and `Chain.order` itself, which refuses a ready set it would not return whole. Either way the goals are still printed — the work standing is a fact this listing read whatever happened to its sequence — in the queue's own default order, behind `goals: served order withheld — <reason>; these rows follow the queue's own default order instead`, with the reason also on stderr, so a fallback order is never read as the served one. What a failed filing read does withhold is the standing spans: each row reads `standing withheld` rather than a span measured from a filing nothing answered, where a goal no commit has filed yet reads `not yet filed in git` and one dated after the instant the row is measured to reads `standing unmeasurable`. Then, last of the listing, the flow row — `flow: median filing→ship 2h 0m; longest ready wait 2d 12h; failed merges per ship 0.25` — the median time from filing to shipping over the verdict history, the longest any ready `work` entry has been waiting right now, and the failed merges that history recorded per entry it shipped. Every figure is derived at the moment of asking and none is stored: the filing times are `git log`'s add commits under the queue directory, exactly the times a selection orders by, and the ships and merge fates come off `.flume/tick-verdicts.jsonl`, which the row therefore reads on every status rather than only under a live supervisor. A failed merge is a cherry-pick that would not land — the merge stage's own failure; a span whose gates reverted it after it landed is a gate failure over a merge that succeeded and is not counted here. A tag the history shipped twice is measured from the one filing git holds for it, the oldest add under its filename. A figure with no population to fold reads `not yet measurable` rather than zero — no ship the filing times can date, no ready entry they can date, or no ship at all to divide by — and a filing read git cannot answer (a cwd no repository holds, a repository with no commit yet, a queue relocated outside the repo root where git cannot name it) withholds the two figures it feeds, says so in the row in place of them, and puts the reason on stderr, rather than printing a queue nothing was ever filed into. A missing or broken chain can never fail status and withholds nothing above that line: it withholds those two, leaves the pending count reading the default `.flume/plan/pending/` even where the chain declares another `Chain.pendingDir`, and says so twice. Once as a row of this listing — `chain: failed to load — <reason>`, printed on stdout with every other line and ahead of the count it explains, so a status over a chain that did not load never has the shape of a healthy one. Once on stderr, where the load names the failure, what it cost, and the refusals that bound it (`flume tick` and `flume check` exit non-zero on this same load). Degraded, never silent: a prompt or watch loop parsing the stdout listing reads that extra row, not a count with nothing to say it had been rebased. Observational only — nothing on disk changes. Exits `0` for every state it observes — a dead supervisor, a corrupt queue, a detached HEAD, a chain that will not load are all reports rather than failures — and exits `74` (`EX_IOERR`) only when the bay discovery every verb starts with cannot hand it a usable root — the state root (`.flume`) is present but will not stat, an unstattable bay being refused rather than walked past to an unrelated ancestor's, naming the cwd the walk began at and the underlying error, or the bay it resolves sits below the root git names paths from, refused before any path is composed against it, naming both roots — or when the root it resolved stats clean and is not a directory, so nothing — the baton this verb reads included — can be read or made beneath it, refused where the roots resolve and naming the resolved root rather than left to exit 1 on a raw stack — or when the root stats as a directory and the state under it will not open, which no stat ahead of the access reaches: a plain file standing where the awake-flag dir belongs fails this verb's listing of it on every host and for every uid, and the refusal names the state root this process resolved rather than the leaf the errno carried — or when a file it must read is present and unreadable (`loop.pid`, the stop flag, the tip claim, the verdict history `tick-verdicts.jsonl` the flow row folds, or, under a live supervisor, the rest of what the spend line reads — the rows files under `.flume/invocations/`, and the `.flume/rendered-prompts/` listing that trailing count is drawn from), so no observation is ever printed as its opposite. An absent state root is none of these — that is an ordinary first run. Status is the right call to bake into shell prompts or watch loops without risk of side effects.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume status
# awake: plan
# tip claimed by pid 4821 for /home/you/project/.flume
# pending: 3
```

## `flume tick`

Runs one phase × one agent invocation. Loads `.flume/chain.ts`, selects whichever phase is awake (singleton phases run once; fanout phases dispatch one pending entry per worktree in a single wave), invokes the agent, and applies the phase's after-commit and after-merge gates. A gate failure reverts the offending commit; the entry stays in pending for the next tick. Side effects: zero or more commits on the current branch, possible worktree creation under `.flume/worktrees/`, session capture under `.flume/sessions/`, one usage row appended to `.flume/invocations/<phase>.jsonl` as each of the tick's agents returns, and baton edits under `.flume/awake/` when a phase hands off or hibernates. Exits `0` on success or on hibernation (no phase awake). Exits `2` on usage — a stray trailing positional (`tick` consumes none: which phase to run is said with `--phase <name>`, so a bare word is refused rather than honored as something the operator never typed), `--phase` carrying no name after it, `--phase <name>` naming a phase the chain does not declare, or a chain load that failed the CJS-context refusal (the host repo's `package.json`, or the one beside `.flume/chain.ts`, lacks `"type": "module"`) — all nameable fixes, which is why they land here rather than in the mount-dead class. Exits `69` (`EX_MOUNT_DEAD`) when the chain fails to load for any other reason, and when the chain mounted and the selected phase's declared prompt file would not read — nothing at the address, a directory, a denial — where the refusal names the resolved path and the `promptPath` the chain declared, no worktree is provisioned, and the phase is left awake for a tick that can be handed one: the mount-dead class either way (`spec/loop.md`, "Exit codes — the run never lies to CI"), because no agent ran and nothing there is retryable by waiting — a fresh process reads that same address until the file is restored, which is the fate `flume render` already gives the same chain. Exits `74` (`EX_IOERR`) when the bay discovery every verb starts with cannot hand back a usable root — the state root (`.flume`) is present but will not stat, an unstattable bay being refused rather than walked past to an unrelated ancestor's, naming the cwd the walk began at and the underlying error; or the bay it resolves sits below the root git names paths from, refused before any path is composed against it, naming both roots; or the root it resolved stats clean and is not a directory, so nothing can be read or made beneath it: refused where the roots resolve, ahead of the chain load and the agent, naming the resolved root rather than the first path under it the tick would have written; or the root stats as a directory and the state under it will not open, refused at the access itself, which no stat ahead of it reaches — the tick reads the baton to pick its phase, and writes a flag back into it at handoff — naming the resolved root rather than the leaf the errno carried — or when the verdict history (`.flume/tick-verdicts.jsonl`) that the tick reads before appending its own record is present and unreadable, where the tick's work has already landed and the code names the recording failure rather than the tick, whose outcome is in the summary it printed. An absent state root is none of these — that is an ordinary first run. Exits `78` (`EX_CONFIG`) on terminal misconfiguration — a chain that resolved but declares an inconsistent world, today every awake flag naming a phase it does not declare, with the flags left on disk to inspect. Exits `1` on other harness error (unexpected exception), when HEAD is detached (a tick's meaning is advancing a named tip, and the claim below keys on a ref; checkout a branch first), when another live process holds the advisory tip claim for the ref HEAD names — a bare tick acquires that claim around its single tick and releases it at exit (`spec/loop.md`, "The loop lock and the tip claim"), so two bare ticks on one ref refuse rather than interleave, while a loop-spawned child runs under its supervisor's claim and takes none; the refusal names the holder's pid, the state root that holder took the tip for, the root this invocation resolved, and the claim path, and no agent runs — or when a wave's entries merged and gated clean and the pending-ledger commit that retires them then refused: a paused merge or cherry-pick standing in the checkout, a lost `index.lock`, a disk error. The shipped entries are on trunk and the chain mounted fine, so this is an ordinary harness error rather than the mount-dead class — `flume loop` logs it and takes a fresh process instead of fail-fasting the run. The one ledger refusal that is *not* this: an entry file that will not parse exits `69`, because the next process reads the same bytes until the queue's declared writer runs over them. Exit `1` again for a wave that ran and was then torn down by a throw out of one of its own legs — an agent that exploded, a hook that threw, a render that did not resolve, a write inside the merge stage the disk refused: the spans that merged and gated before it are on trunk, this tick's verdict names them with a usage row per agent that ran, and the chain mounted fine, so a fresh process has every reason to get further. An undeclared `--phase <name>` is not that class but the usage one above: the refusal names the phases the chain does declare, no agent is invoked and no baton flag moves, and the chain itself mounted fine — what failed is argv, the same refusal `wake`, `sleep` and `render` already answer an undeclared phase name with, carrying one code whichever verb was handed the name.

Before each cherry-pick onto the current branch, the tick asks whether another process holds a live claim on this tip (`spec/loop.md`, "Tip verify — one writer per branch, absorption at the merge") — never whether the tip still matches a sha recorded at tick start. No live foreign claim → whatever moved the ref was not an engine, so the span picks onto whatever tip is current and an operator's mid-tick commit is absorbed under it; git's own conflict detection arbitrates content (a conflicting pick aborts and that entry stays pending; a commit the tip already holds empties against it and is skipped instead — absorbed, never a conflict — and a span the tip holds whole merges with no commit to add, reported as a `merged` outcome whose two shas are equal), and the phase's after-merge gates validate the merged tree. A live claim held by another process — a second engine interleaving merges onto one ref — → **no commit** for every entry not already merged: the agent's output is left on disk untouched, the entry stays pending, and the printed summary reads `no commit (tip-moved)` in place of the usual `shipped <tags>`/`committed <sha>`. The agent's own commits are checked separately and before any gate, by ancestry against the base its worktree branched from: a base that is no longer an ancestor of what the agent left is refused the same way, naming both shas. Exit code stays `0` — a tip-moved tick is a settled no-op from `tick`'s own perspective, the same as any other tick that produced no commit; `flume loop` is what treats a tip-moved tick as a run-level fact (below).

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

**`--phase <name>`** runs that phase whatever the baton says — awake or not — and is how `flume loop`'s supervisor tells a child what it is for (`spec/loop.md`, "Baton — presence wakes, absence hibernates"). Selection is the only thing it changes: the named phase is slept after it runs and its handoff wakes whatever it returns, exactly as a bare tick's would, and a flag standing for some other phase is neither consulted nor cleared. A name the chain does not declare is refused before any work, usage-shaped (exit `2`) like every other verb's.

Every line this verb writes to the operator — the phase it dispatched, the tick's outcome summary, and each refusal above — opens with the instant it was written (`docs/CLI.md`, *Narration carries the instant it was written*).

```sh
flume tick
flume tick --phase build   # run build, awake or not
```

## `flume loop [--max N]`

Runs tick children until the baton hibernates (no phase awake) or `--max` ticks have been spent. `--max` defaults to `50` and exists as a safety cap so a runaway chain doesn't loop forever in CI or unattended runs. The supervisor starts one `flume tick` child per awake phase that has none of its own in flight, in the chain's declared order, up to `supervisorPolicy.maxTicks` at once (default `1` — one phase tick at a time, the serial loop); each child is told its phase, and the run ends once no flag stands and no child is in flight. The two caps are distinct: `--max N` is how many children this run may start in total, `supervisorPolicy.maxTicks` is how many it holds at once. Each child has the same side effects as `flume tick`. `loop` resolves the chain in its own process before the first child — for the declared phase order it schedules by and the `supervisorPolicy` it binds — so a chain that will not load ends the run `69` (`EX_MOUNT_DEAD`) there, naming the load error and starting no tick at all. Past that, a child tick that exits `69` (a chain that loaded for the supervisor and not for the child, a phase whose declared prompt file would not read, or a queue that would not parse) does not end the run on the child's word alone: the supervisor re-reads the mount at the tip, as the next child would, and halts only while a wall still stands — the chain still will not load, the exiting phase's declared prompt file still will not read, or the queue still will not read at the tip — rather than spending the remaining children on it. A child that exits `69` for a cause that no longer holds — a sibling's repair (the queue's declared writer running over a failed parse) or an operator's fix landed in the gap — is an errored tick and nothing more: the run goes on, and a run of nothing but those exits `1` rather than `69`. A child that exits `78` (`EX_CONFIG`, terminal misconfiguration) halts the run outright, the misconfiguration being the declared world's rather than a wall a sibling can repair. Either halt starts no further child, drains the ones already in flight, and propagates that same code. `78` is also the loop's own verdict when every flag still standing names a phase the chain does not declare, so there is no child left to classify it — exiting `0` there would re-mask either as clean at the next process boundary up. Otherwise (`spec/loop.md`, "Exit codes — the run never lies to CI"): exits `0` on hibernation, on hitting the `--max` cap, or on partial success (some entries shipped despite other ticks erroring); exits `1` when at least one tick errored **and** the run shipped nothing, and when the consecutive-failure backstop aborted the run — an identical provision-stage, render-stage, merge-stage, gate-stage, ship-stage or platform-stage failure signature on as many consecutive ticks as the chain's `supervisorPolicy.abortThreshold` declares, with no successful tick between them. The platform stage is the run's own wall rather than an entry's — an agent that failed for non-work reasons, keyed by its preempt class — so it aborts the run without ever quarantining anything. A graceful stop mid-run (`.flume/stop` written while the loop is already going) starts no further child and ends the run once every in-flight tick has finished, but never changes the code — it stays decided by the run's totals either way. Any errored ticks are named in the completion summary regardless of exit code — a partial-success `0` exit never hides them silently. Wherever that summary is printed it names the run's yield: `shipped <tags>`, or `shipped nothing` when the run shipped none, ahead of the errors and the run's agent spend, so a run that burned a whole budget shipping nothing never prints the shape of a productive one. The yield never causes the line on its own — a run with no errors, no abort, no stop flag and no spend to report still prints nothing. This is the standard autonomous-run entry point — wire it into a long-running shell, a `tmux` pane, or a scheduler.

Bay discovery runs ahead of the argument checks, and `loop` exits `74` (`EX_IOERR`) where it cannot hand back a usable root — the state root (`.flume`) is present but will not stat, an unstattable bay being refused rather than walked past to an unrelated ancestor's, naming the cwd the walk began at and the underlying error; or the bay it resolves sits below the root git names paths from, refused before any path is composed against it, naming both roots; or the root it resolved stats clean and is not a directory, so nothing can be read or made beneath it: refused where the roots resolve, ahead of the tip claim and the first tick, naming the resolved root rather than the first path under it the run would have taken; or the root stats as a directory and the state under it will not open, refused at the access itself, which no stat ahead of it reaches — the supervisor reads the baton off the root before it starts the first child and at every child boundary after — naming the resolved root rather than the leaf the errno carried. An absent state root is none of these — that is an ordinary first run. Arguments are checked before anything else runs: `loop` exits `2` on a `--max` value that is missing or not a decimal integer: the empty string, whitespace, a signed, fractional, hex or exponent literal, and a digit run past what a finite number holds are each refused rather than read as a count, so a wrapper spelling `--max "$BUDGET"` over an unset variable is refused instead of starting no tick and reporting a completed run. It exits `2` on a stray positional past `--max <value>` as well — it consumes none, so running something other than what was typed is refused rather than silently started. The stop flag is read next (`spec/loop.md`, "Graceful stop — the stop flag"): a `.flume/stop` already present refuses with exit `1` — remove it to acknowledge the stop before starting a new run — and a flag that exists but cannot be stat'd exits `74` (`EX_IOERR`) naming the underlying error, rather than starting the run, because an unreadable flag is not an absent one (`.claude/rules/engineering.md`, "Loud or nothing").

Before the first tick, `loop` refuses (exit `1`) on a detached HEAD, then acquires the advisory tip claim (`spec/loop.md`, "The loop lock and the tip claim": one flume writer per tip) for the ref HEAD resolves to — exclusive-create at `<git-common-dir>/flume/tip-claims/<ref path>`, visible from every linked worktree sharing that `.git`. A live holder refuses (exit `1`, naming the holder's pid, the state root that holder took the tip for, the state root this run resolved, and the claim path); a stale claim (holder process dead) is reclaimed silently and the loop proceeds. The claim is released on normal exit, `SIGINT`, `SIGTERM`, and a hangup — `SIGHUP`, or `SIGBREAK` on win32, the closed-console pair that under node's default disposition ended the process with nothing released and no end recorded (`spec/loop.md`, "Crash equals stop"). It stands beside, not instead of, the `loop.pid` state-root lock above — the two guard different resources (a ref vs. a state root). That lock is read the same way the stop flag is: a `loop.pid` that is present but cannot be read — a directory at the path, permission denied — exits `74` (`EX_IOERR`) naming the underlying error, because a lock whose holder is unknown is not a free one. Both files carry the same first two lines: the holder's pid first, the ISO-8601 instant it took the guard second. Every liveness reader takes the first line, so a reader after "who holds this" looks where it always has; the second is what `flume status` bounds the live run's agent spend by, in place of the lock file's mtime. The tip claim carries a third line the lock has no use for — the state root its holder resolved, which is what its refusal names the holder's root from; `loop.pid` sits under the root it guards, so its own path already says it. A reader that wants only the lines above ignores whatever stands under them, which is how the tip claim grew that line without changing what any liveness reader does. Two efforts in one checkout, each under its own `FLUME_DIR`, are what makes the difference visible: the state-root lock never collides (two roots, two locks), so the tip claim is the guard that stops the second — and it says which root holds the tip and which one was refused, rather than reporting a tip that is merely busy. A file written by flume before `0.17` states only the pid, and still names its holder — but a flume before `0.17` reads a two-line file as no pid at all and reclaims the guard out from under a live run, so a state root or a `.git` reachable by two versions is upgraded in one go ([`MIGRATING-0.17.md`](MIGRATING-0.17.md)). A tick that hits the tip-moved outcome (see `flume tick`, above) counts as an errored tick for this command's own exit-code and summary accounting, same as a gate-revert: the run keeps going, but a run that ships nothing while hitting tip-moved exits `1`, and the tick is named in the completion summary regardless.

Under that claim, and before the ignore merge and the startup sweep, `loop` reads the interrupted-merge markers (`spec/loop.md`, "Crash equals stop"): a `.flume/merging/` dir that exists but cannot be listed exits `74`, since whether a marker stands behind it is then unknown; a marker that *is* standing — a merge that died between the cherry-pick and the queue rewrite, so the picked commit may sit on trunk ungated with its entry still open — exits `78`, naming the file, the branch and the entry. Nothing is touched and the startup sweep does not run, so each branch named survives for reconciliation; removing the marker is the acknowledgement, as with the stop flag.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

The supervisor's own lines carry the same stamp every operator line does (`docs/CLI.md`, *Narration carries the instant it was written*), and each child's reach the operator through the streams the supervisor hands it, so one run's log is one ordered, dated stream whichever process wrote each line.

```sh
flume loop --max 20
```

## `flume wake <phase>`

Marks the named phase awake by touching `.flume/awake/<phase>`. The next `flume tick` (or `flume loop`) will schedule that phase. The phase name is validated against the repo chain's declared phases behind the same best-effort load `flume status` takes: a chain that loads and does not declare `<phase>` refuses with exit `2` before the flag is written, while a missing or broken chain never blocks the flag — it reports the failure and what it cost (nothing checked the phase name, so a typo lands a marker no phase will ever read) on stderr, never silently. The chain is repo-resident: only `FLUME_CONFIG_DIR` moves the dir it loads from. Exits `0` on success; exits `2` if the `<phase>` argument is missing, if an extra positional follows it, or on an undeclared phase; exits `74` (`EX_IOERR`) when the bay discovery every verb starts with cannot hand back a usable root — the state root (`.flume`) is present but will not stat, an unstattable bay being refused rather than walked past to an unrelated ancestor's, naming the cwd the walk began at and the underlying error; or the bay it resolves sits below the root git names paths from, refused before any path is composed against it, naming both roots; or the root it resolved stats clean and is not a directory, so nothing can be read or made beneath it: refused where the roots resolve, ahead of the verb's own work, naming the resolved root rather than the first path under it a verb would have tried; or the root stats as a directory and the state under it will not open, refused at the access itself, which no stat ahead of it reaches — the awake-flag dir this verb makes under the root, or the flag file it writes in that dir — naming the resolved root rather than the leaf the errno carried. An absent state root is none of these — that is an ordinary first run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume wake plan
```

## `flume sleep <phase>`

Removes `.flume/awake/<phase>`, taking the named phase out of the awake set. No-op if the flag file is already absent. The phase name is validated exactly as `wake` validates it, through the same best-effort chain load and with the same stderr report on a chain that fails to load. Use this to force-hibernate a phase mid-run, e.g. to pause an autonomous loop while inspecting state. Exits `0` on success (including the no-op case); exits `2` if `<phase>` is missing, if an extra positional follows it, or on an undeclared phase; exits `74` (`EX_IOERR`) when the bay discovery every verb starts with cannot hand back a usable root — the state root (`.flume`) is present but will not stat, an unstattable bay being refused rather than walked past to an unrelated ancestor's, naming the cwd the walk began at and the underlying error; or the bay it resolves sits below the root git names paths from, refused before any path is composed against it, naming both roots; or the root it resolved stats clean and is not a directory, so nothing can be read or made beneath it: refused where the roots resolve, ahead of the verb's own work, naming the resolved root rather than the first path under it a verb would have tried; or the root stats as a directory and the state under it will not open, refused at the access itself, which no stat ahead of it reaches — the flag file this verb removes from the awake-flag dir under the root — naming the resolved root rather than the leaf the errno carried. An absent state root is none of these — that is an ordinary first run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume sleep plan
```

## `flume hold <phase>`

Holds the named phase — the operator's own end of the baton: removes `.flume/awake/<phase>` and writes `.flume/held/<phase>`. While the hold stands, a handoff's wake of that phase is declined and reported on the tick verdict with its reason, and neither `flume loop`'s supervisor nor a bare `flume tick` runs the phase; `flume tick --phase <phase>` does, as the operator's own explicit action (`spec/loop.md`, "Baton — presence wakes, absence hibernates"). `flume wake <phase>` removes the hold, wakes the phase and says it did — a handoff never removes one, because the hold is the operator's and the wake a handoff performs is not the verb. Idempotent, and the two markers are separate facts on disk: the marker is written before the flag is removed, so no instant leaves the phase pickable with the hold recorded nowhere, and a repeat call stands the same marker up and prints the same statement. The printed line names both moves — `held <phase> — awake flag cleared` where a flag stood, `held <phase>` where none did. The phase name is validated exactly as `wake` validates it, through the same best-effort chain load and with the same stderr report on a chain that fails to load. Exits `0` on success (including when the hold already stood and when no flag stood to clear); exits `2` if `<phase>` is missing, if an extra positional follows it, or on an undeclared phase, with no marker written; exits `74` (`EX_IOERR`) when the bay discovery every verb starts with cannot hand back a usable root — the state root (`.flume`) is present but will not stat, an unstattable bay being refused rather than walked past to an unrelated ancestor's, naming the cwd the walk began at and the underlying error; or the bay it resolves sits below the root git names paths from, refused before any path is composed against it, naming both roots; or the root it resolved stats clean and is not a directory, so nothing can be read or made beneath it: refused where the roots resolve, ahead of the verb's own work, naming the resolved root rather than the first path under it a verb would have tried; or the root stats as a directory and the state under it will not open, refused at the access itself, which no stat ahead of it reaches — the hold-marker dir this verb makes under the root, the marker it writes in that dir, or the awake flag it removes beside them — naming the resolved root rather than the leaf the errno carried. An absent state root is none of these — that is an ordinary first run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume hold build
# held build — awake flag cleared
flume wake build
# woke build — hold cleared
```

## `flume stop`

Writes `.flume/stop` and prints what happens next: with a live supervisor, that it
finishes its in-flight tick and ends the run; otherwise, that the next `loop`
refuses to start until the flag is removed. Idempotent — running it again
while the flag is already present rewrites the same empty file and prints the same
statement. The verb is discoverability, not a privileged channel: `touch .flume/stop`
is equally the interface, and nothing distinguishes the two writers. There is
deliberately no `unstop` / `resume` verb — removing the flag is the operator's own
acknowledgement that they saw the stop, and an engine verb that removed it would let
a script ack a stop no human saw. Consumes no positionals; a trailing argument is
refused before the flag is written. Exits `0` always; exits `2` if given any
argument; exits `74` (`EX_IOERR`) when the bay discovery every verb starts with cannot
hand back a usable root — the state root (`.flume`) is present but will not
stat, an unstattable bay being refused rather than walked past to an unrelated
ancestor's, naming the cwd the walk began at and the underlying error; or the
bay it resolves sits below the root git names paths from, refused before any
path is composed against it, naming both roots; or the root it resolved stats
clean and is not a directory, so nothing can be read or made beneath it —
refused where the roots resolve, ahead of the verb's own work, naming the
resolved root rather than the flag path under it; or the root stats as a
directory and the state under it will not open, refused at the access itself,
which no stat ahead of it reaches — the flag this verb writes under the root
is its whole effect, so a directory standing at that path walks past every
stat above it and fails the write — naming the resolved root rather than the
leaf the errno carried. An absent state root is none of these — that is an ordinary first
run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume stop
# [flume] wrote .flume/stop: a live supervisor finishes its in-flight tick and
# ends the run; the next `loop` refuses to start until the flag is removed.
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
Mutates nothing. Exits `0` on success; exits `2` if `-n` is missing its value
or not a decimal integer — the empty string, whitespace, a signed, fractional,
hex or exponent literal, and a digit run past what a finite number holds are
each refused rather than read as a count — or given any other unrecognized
argument; exits `74`
(`EX_IOERR`) when `tick-verdicts.jsonl` is present but cannot be read — exit
`0` over silence means the log is not there, never that it could not be
opened — and when the bay discovery every verb starts with cannot hand back a
usable root: the state root (`.flume`) is present but will not stat, an unstattable
bay being refused rather than walked past to an unrelated ancestor's, naming the cwd
the walk began at and the underlying error; or the bay it resolves sits below the
root git names paths from, refused before any path is composed against it, naming
both roots; or the root it resolved stats clean and is not a directory, so nothing
can be read or made beneath it: refused where the roots resolve, ahead of the verdict
read, naming the resolved root rather than the history path under it. An absent state
root is none of these — that is an ordinary first run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume log -n 3
# plan  committed=true  gates=[tsc:ok,vitest:ok]  shipped=[]  merge=[]
# build  committed=true  gates=[tsc:ok,vitest:ok]  shipped=[DOCS-CLI-1]  merge=[DOCS-CLI-1:merged]
# build  committed=false  gates=[tsc:FAIL]  shipped=[]  merge=[]

flume log --json
# {"phaseName":"build","committed":true,"gateResults":[...],"shippedTags":["DOCS-CLI-1"],"mergeOutcomes":[...]}
```

## `flume check`

Validates the working tree's `.flume/plan/pending/` without spending an agent:
the real parse (the same decode a tick's resolution takes) plus fence arithmetic for
every entry — each entry's declared paths checked against the consumer fanout
phase's declared fence, the same computation the write guard enforces at commit
time. Read-only — touches no baton flag, loads the chain only to compute the fence,
and invokes nothing. Scope is deliberately the engine's own mechanics alone; chain
gates need a tick's `GateContext` and do not run here. Every `*.json` directly
under the directory is an entry and a subdirectory is not walked, so a chain may
keep sidecars beside them; an entry file whose `tag` disagrees with its filename
is refused naming both. No queue directory present prints `plan/pending absent —
nothing to check` and exits `0`. A chain that
declares no fanout phase has no consumer and therefore no fence: the parse still
runs, the fence step is skipped, and the output says `no fanout phase declared;
fence not checked` — vacuous by design and spelled out, never a refusal of every
declared path. Consumes no positionals. Exits `0` when every entry parses and
every entry's paths clear the fence (and on either skip above); exits `65`
(`EX_DATAERR`) on a parse failure or a fence violation, naming the
offending entry file and paths — the same refusal the next tick would otherwise have
spent an invocation to discover; exits `2` if given any argument; exits `69`
(`EX_MOUNT_DEAD`) if the chain itself fails to load; and exits `74` (`EX_IOERR`)
when `plan/pending/` is present but cannot be listed or read, or when the bay
discovery every verb starts with cannot hand back a usable root — the state root
(`.flume`) is present but will not stat, an unstattable bay being refused rather than
walked past to an unrelated ancestor's, naming the cwd the walk began at and the
underlying error; or the bay it resolves sits below the root git names paths from,
refused before any path is composed against it, naming both roots; or the root it
resolved stats clean and is not a directory, so nothing can be read or made beneath
it: refused where the roots resolve, ahead of the parse and the chain load, naming
the resolved root rather than the queue path under it. An absent state root is none
of these — that is an ordinary first run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume check
# plan/pending valid (3 entries), fence check passed

flume check
# [flume] check: 1 pending entry declares files outside the consumer phase's fence
#   [DOCS-CLI-1] src/forbidden.ts

flume check   # a chain with no fanout phase
# plan/pending valid (3 entries), no fanout phase declared; fence not checked
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
sent stays in `rendered-prompts/`. Read-only, with no filesystem effect at all:
the baton is not read and not created, no baton flag is set, no worktree is
provisioned, no `rendered-prompts/` record is written, and no hook refusal is
persisted.

Exits `0` once the prompt is on stdout. It exits `2` on any usage-shaped
refusal (missing `<phase>`, a stray positional past it, `--entry` with no value,
an unknown phase, `--entry` against a phase that picks nothing, `--entry` naming
no entry in the queue at HEAD, a fanout phase with nothing pickable and no
`--entry`, or the CJS-context chain-load refusal). It exits `65` (`EX_DATAERR`)
when the prompt never resolved — an inline-exec span that would not resolve,
each failing span named with its stderr; a `{{KEY}}` no arg filled, every such
key named at once; or a `promptArgs` hook that threw — the one
`render-refused` class a tick would have spent an invocation to reach. It
exits `69` (`EX_MOUNT_DEAD`) when the chain could not be brought up at all — it
failed to load, the queue at HEAD failed to parse, or the declared prompt file
is not on disk. And it exits `74`
(`EX_IOERR`) — the state root's own refusals, and this verb's only ones —
when the bay discovery every verb starts with cannot hand back a usable root:
the state root (`.flume`) is present but will not stat, an unstattable bay
being refused rather than walked past to an unrelated ancestor's, naming the
cwd the walk began at and the underlying error; or the bay it resolves sits
below the root git names paths from, refused before any path is composed
against it, naming both roots; or the root it resolved stats clean and is not
a directory, so nothing can be read or made beneath it — refused where the
roots resolve, ahead of the chain load this verb starts with, naming the
resolved root. Nothing past that: this verb touches none of the state under
the root, so the refusal a root that stats as a directory and admits no
access raises is one its process never reaches. An absent state root is none
of these — that is an ordinary first run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

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
count on `flume status` skips it — a `.gitkeep` git made
the consumer create for an otherwise-empty, gitignored channel dir is no work. The
skip is by name alone, never by content. A chain that declares no
`Chain.friction` refuses usage-shaped, naming the missing declaration. A declared but
not-yet-created directory lists empty and exits `0` — the directory is created
lazily by whichever engine write needs it first. Exits `0` on a successful list or
read (including the empty-directory case); exits `2` if the chain declares no
`Chain.friction`, if given more than one argument, or if `name` names no note in the
directory; exits `69` (`EX_MOUNT_DEAD`) if the chain fails to load; exits `74`
(`EX_IOERR`) if the channel dir, or a note in it, exists but cannot be read or
stat'd — the named read, the bare list's directory read, and the bare list's
per-note stat all refuse rather than report the note missing or the channel empty,
and a refused list prints no rows at all rather than a partial listing; and it exits
`74` when the bay discovery every verb starts with cannot hand back a usable root —
the state root (`.flume`) is present but will not stat, an unstattable bay being
refused rather than walked past to an unrelated ancestor's, naming the cwd the walk
began at and the underlying error; or the bay it resolves sits below the root git
names paths from, refused before any path is composed against it, naming both roots;
or the root it resolved stats clean and is not a directory, so nothing can be read or
made beneath it: refused where the roots resolve, ahead of the channel read, naming
the resolved root rather than the channel path under it. An absent state root is none
of these — that is an ordinary first run.

Exits `2`, too, where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published.

```sh
flume friction
# revert-note-a54de89.md  412  2026-09-06T14:02:11.000Z

flume friction revert-note-a54de89.md
# (bytes of the note, written verbatim to stdout)
```

## `flume exclusive -- <command> [args...]`

Runs `<command>` with the ship lock held — the guard a tick holds across its whole merge span: every cherry-pick onto the trunk, the `afterMerge` gates over the merged tree, and the ledger commit that ships the span (`spec/loop.md`, "The ship lock and the worktree lock — sibling ticks take turns at git"). The lock is taken exactly the way a sibling tick takes it: a live holder is **waited** for, with the wait announced on stderr naming the holder's pid and the lock file, and a holder whose pid names no live process is reclaimed. A tick that finishes while the command runs waits in turn, so the merge lands after the command rather than across it. Agents keep working throughout — the lock serializes merges, not ticks.

This is the verb for landing something on trunk mid-run: a merged remote change, a hand fix, a rebase — the window a tick's tip verify refuses (`spec/loop.md`, "Tip verify — one writer per branch, absorption at the merge"). The command stays entirely yours. No shell is spawned, so the words typed are the words the command gets; the working directory is the one the command was typed in, not a root the verb resolved; stdin, stdout and stderr are this terminal's, so a `git fetch`'s progress arrives while it happens. flume reads nothing out of it — no remote, no branch, no merge strategy — and nothing it printed is interpreted: the verb holds a lock and carries an exit code.

It is the one verb that takes a lock, and it takes only this one. The worktree lock is never taken, so nothing stalls tick provisioning for the length of a fetch; no verb drops either lock; and `flume status` prints nothing about them — a held lock is a tick or an operator command in flight. A signal that ends the verb before it releases (a Ctrl-C, which runs no handler) leaves the lock file standing with the dead pid recorded, and the next acquirer reclaims it by the same liveness probe every stale holder gets.

Exit code is the command's own, whichever it exited with: that is the whole promise of the verb, so a successful command exits `0` and every non-zero code a command can return reaches the caller unchanged; a command a signal ended exits 128 plus that signal's number, the convention flume's own signalled exits follow. flume's own refusals are taken before the command runs or in place of it. It refuses usage-shaped (exit `2`) on a command line it cannot honor as typed — no `--` separator, nothing behind the separator, or a word ahead of it, since the verb consumes no positional of its own and everything behind the separator is the command (a `--help` behind it is the command's, never this page's). It also exits `2` where the state-root resolution every verb starts with refused the pair of roots it was handed — an inherited `FLUME_DIR_RESOLVED_FOR` stamp names a different repository than this invocation resolved, which would otherwise write into the outer repository's control plane, or a relocated state root resolved in a checkout that already holds flume state of its own, where one checkout resolves one state root and the second separates nothing — each refused where the roots resolve, ahead of the verb's own work and before either root is published. It exits `69` (`EX_UNAVAILABLE`) where nothing ran: the ship lock never resolved, its directory being git's own, so a working directory git holds no repository for has nothing to lock and the command is not started; or the command itself never started — a binary `PATH` does not hold, or a Windows `.cmd` shim, which no shell is spawned to reach, so an operator wanting one names its interpreter in the command. Either names the underlying error, and a command that never started has no code for this verb to carry. And it exits `74` (`EX_IOERR`) where the bay discovery every verb starts with cannot hand back a usable root — the state root (`.flume`) is present but will not stat, an unstattable bay being refused rather than walked past to an unrelated ancestor's, naming the cwd the walk began at and the underlying error; or the bay it resolves sits below the root git names paths from, refused before any path is composed against it, naming both roots; or the root it resolved stats clean and is not a directory, so nothing can be read or made beneath it, refused where the roots resolve and naming the resolved root. An absent state root is none of these — that is an ordinary first run.

```sh
flume exclusive -- git pull --ff-only
# [flume] waiting for the ship lock held by pid 4821 (/home/you/project/.git/flume/ship.lock)
# Updating 9f2c1ab..3b71d4e
# Fast-forward

flume exclusive -- git merge --no-ff origin/main   # exits with git's code
```

## `flume-harness init`

A verb on the *other* bin. The harness package ships its own command line beside the engine's, so `flume`'s verb set stays closed and `src/` never imports the harness (`spec/harness.md`, *Adoption and upgrade*). It is the same npm package and the same version, so one install provides both — before the dependency is there, `npx --package @dtmd/flume flume-harness init`; once it is, `pnpm exec flume-harness init`. `flume-harness` with no verb, or with `-h` / `--help` anywhere on the command line — `flume-harness --help` and `flume-harness init --help` alike — prints the verb list and exits `0`, before anything is written.

`init` adopts the harness into the repository it is run in: the repository is the current working directory and the state root is `.flume`. The verb takes no arguments and no flags — no state-root selector; adopting into a different root is the exported `harnessInit({ repoRoot, stateRoot })`, a library call rather than a command line. Two steps, the first entirely a preflight:

1. **Resolve every input before the first byte.** The state root's absence (a stat failure that is not absence refuses rather than reading as "not adopted yet"), this package's own manifest for the version range to declare, the shipped `PROTOCOL.md` template, and the repository's `package.json` if it has one. Nothing on disk is touched until all of them pass: an init that stopped half-way would leave ignore lines for a state root that does not exist, or a `PROTOCOL.md` beside no declaration — a tree nothing refuses and no re-run can tell from a finished one.
2. **Write the adoption, then report it.** `.flume/package.json` (`"type": "module"` and nothing else — the module scope the two files beside it load in: flume is ESM-only, a chain loaded as CommonJS stops resolving it on node 22, and your own repository's manifest is untouched, so a CommonJS repo adopts and its chain still loads), `.flume/declaration.ts` (the skeleton whose `specLocus`, `fence` and `slices` are yours to fill in), `.flume/chain.ts` (the hop the engine loads — the same three lines in every adopting repository, and nothing in it yours to tune), `.flume/PROTOCOL.md`, and `.flume/plan/pending/` holding an empty queue — one `<tag>.json` per entry once a plan slice writes them, and a `.gitkeep` so git keeps the directory once every entry has shipped: nothing else creates it, and a plan slice refuses over an absent queue. Last, `.flume/plan/state/` gets one state file per plan slice that keeps a cursor, each stamped at the commit the repository was standing at when init ran, so the first plan wave is about what lands after the adoption rather than about the whole history before it (without the seed a cursor reads as "nothing derived yet", which sends the first derive tick over your entire spec corpus and makes the sweep live over your entire declared domain). A repository standing at no commit — freshly `git init`ed, or no git checkout at all — is seeded with none: a cursor is a sha, there is none to stamp, and the report says so rather than inventing one. Then the runtime ignore lines are *merged* into `.gitignore` — created if absent, and everything already in it kept — and `@dtmd/flume` is declared at `^<version>` in the manifest's `dependencies`. A range already declared (in either `dependencies` or `devDependencies`) is left exactly as it was: a pinned range is a decision, and overwriting it would be init choosing a version on your behalf. No installer is spawned and no lockfile is touched — which package manager reconciles `node_modules` stays yours, and the closing line says what to run next.

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
#   wrote     .flume/plan/pending/.gitkeep
#   wrote     .flume/plan/state/plan-derive.json
#   wrote     .flume/plan/state/plan-sweep.json
#   cursors   plan state starts at 9f2c1ab… — nothing before this adoption enters a plan window
#   ignores   .gitignore +10 line(s) under .flume/
#   depends   @dtmd/flume@^0.15.0 added to package.json
#
# Next: install the dependency, then edit .flume/declaration.ts — its
# `specLocus`, `fence` and `slices` are placeholders.

pnpm exec flume-harness init          # a repository that already adopted
# flume-harness init: /home/you/repo/.flume already exists — refusing to
# overwrite it. ...                                              (exit 1)
```
