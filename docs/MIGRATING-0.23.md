# Migrating to 0.23.0

**This note covers `0.22.x` → `0.23.0` and nothing earlier.** The previous
note in the series is [`MIGRATING-0.22.md`](MIGRATING-0.22.md), which walks
`0.21.x` → `0.22.0`. If your pin is below `0.22.0`, work that note first.

Ten breaks. One lives in your queue files and is checked right after the
upgrade (section 1). Three are at the harness package's runner and setup
surface (sections 2–4) and reach every consumer that declares a runner or
none of `setup`. The rest are at the chain-authoring surface, and most chains
hit one or two. Then the behavior changes worth knowing before the first run.

**Upgrade from a stopped loop.** Run `flume stop`, let the in-flight tick
finish, upgrade, then run `flume check` (section 1) before you remove the stop
flag. The supervisor stays resident at its launch version, and this release
changes how every merge reaches trunk: a supervisor on 0.22 driving 0.23 tick
children would gate on one shape and merge on another.

## 1. The queue read refuses two more `blockedBy` shapes

Both shapes parsed on 0.22 and could never be picked; they are now refused at
the queue read, naming the file, and the tick exits 69.

- **An edge into the declarer's own containment**, for every entry kind. 0.22
  refused it only on a `work` entry. A `group` blocked on its own descendant,
  or a `step` blocked on the step that contains it, now refuses the same way.
- **A cycle that closes through an inherited gate.** An entry inherits every
  ancestor's gate, so a group blocked on a work entry that is blocked on one of
  that group's own descendants is a loop, though no declared edge closes it.

**What to do.** After upgrading and before the first run, run `flume check`.
It reads the queue the way a tick does and names each refused edge by file and
`gate.tags.<n>`. Cut the edge (or re-parent the entry), commit, and check
again. A queue that checks clean needs nothing.

## 2. Harness package: `Lane.excludes` is gone, and a runner answers `coverage`

A lane no longer states what it leaves out. `Lane` is `{ name, runs }`; a
declaration still carrying `excludes` fails to typecheck. What the running
lane leaves out is asked of the test tool through the runner's new
`coverage(cwd)` operation, which answers a `LaneCoverage`: the test files no
judged run reaches, or that it could not tell and why. Plan's named-line hints
are rendered from that answer.

**What to do.** Delete `excludes` from every lane. For `vitestRunner`, name
each lane that does not run by the `--mode` that collects it: the runner lists
the idle lane with `vitest list --mode <name>`, so the lane's `name` must be a
mode your vitest config honours. A consumer with its own `Runner` adds
`coverage(cwd)`; one whose tool cannot list its own selection returns
`{ kind: "unknown", reason }`, which plan is told rather than refused over.

## 3. Harness package: the vitest runner's `invoke` reaches the binary only

`VitestInvocation.args` now stops before the subcommand: the runner appends
`run` for a run and `list` for coverage. An `invoke` that returned
`[..., "run"]` makes every spawn read `run` a second time, as a file filter.
What the suite *is* moved too: scoping flags (`--dir`, `--exclude`,
`--project`, a non-root `--config`) belong in the new `scope` option, which
every spawn receives. The runner reads the JSON report from a file it names
with `--outputFile`, not out of stdout, so a plugin printing to stdout no
longer corrupts the verdict.

**What to do.** If you declare `invoke`, drop `run` (and any scoping flag) from
its `args`. Move scoping flags to `vitestRunner({ scope: [...] })`. Use flags,
not a bare path: a positional filter is read by vitest beside the base run's
own file filters as a union, which widens the run rather than bounding it, and
a base run whose report covers a file none of the judge's lines named is
refused, naming the file and your `scope`. With no `invoke` declared, nothing
changes.

## 4. Harness package: no `setup` and no lockfile is refused at chain load

With `setup` undeclared, every tree the package provisions now gets the
engine's lockfile-aware install at its root — each build worktree, each plan
slice's worktree, each merge candidate (section 6), and the base checkout the
runner judges at. On 0.22 a build worktree got nothing and resolved its tools
out of the checkout above it. Since that installer is now load-bearing for a
consumer that never named it, a repository it cannot read is refused at chain
load, naming both fixes.

**What to do.** If chain load refuses, either commit the lockfile your package
manager writes, or declare `setup` — `{ directories: ["."], restore: "<your
install command>" }` for a stack the installer does not read (cargo, dotnet, a
script). A repository that genuinely needs nothing provisioned says so the
same way, with a `restore` that does nothing (`restore: "true"`): silence is
no longer read as "nothing to install". A consumer with a lockfile needs nothing, and gains an
install per worktree it did not pay before.

## 5. `GateContext.entry` and `GateContext.steps` are `GateContext.assignment`

An entry and its steps are one session's assignment, so the gate context
carries them as one optional value, `assignment: GateAssignment` (`{ entry,
steps }`), set at both stages under fanout and absent on a singleton tick and
under a batch. Each `GateBatchSpan` carries `assignment` the same way.

**What to do.** Replace `ctx.entry` with `ctx.assignment?.entry` and
`ctx.steps` with `ctx.assignment?.steps`; in a batching gate, read
`span.assignment` per span. The typechecker finds every site.

## 6. `afterMerge` gates judge a candidate, and trunk only fast-forwards

Each finished span is cherry-picked onto a **candidate**: a fresh tree of its
own at the current trunk tip. The `afterMerge` gates judge that tree, and on
green trunk fast-forwards to it in one move, span and ledger commit together.
On red, a conflicting pick, a gate that throws or a fast-forward git declines,
the candidate is discarded and trunk stands where it stood. Nothing rewinds
trunk any more, so a push, a CI checkout or a sibling worktree that copied
trunk never holds history trunk later drops. A batch is picked onto one
candidate and gated there.

What a chain sees:

- An `afterMerge` gate's `cwd` and `repoRoot` name the candidate, and
  `configDir` is rebased onto it. `ShipContext.repoRoot` names it too.
- `Phase.setupWorktree` and `teardownWorktree` run over every candidate,
  under the key the span's worktree carried. A throw there is that span's
  merge failure, never the wave's.
- `MergeOutcome` loses `afterMerge-revert-refused` (nothing is reverted) and
  gains `uncommitted-work` (the fast-forward declined to overwrite uncommitted
  work in the checkout) and `merge-walled` (this span's merge stage threw).
- The tick verdict's `bystanderCheckpointSha` is gone.

**What to do.** A gate that opened files under `repoRoot` expecting the
primary checkout opens them under the candidate instead — it holds tracked
files plus whatever `setupWorktree` provisions, so a gate that needs
`node_modules` needs the hook (section 4 gives harness consumers one). An
exhaustive `switch` over `MergeOutcome` drops one arm and gains two. Delete any
read of `bystanderCheckpointSha`. Expect each merge to pay one install: an
expensive check that reads only the span's own change is cheaper at
`afterCommit`, in the span's worktree and parallel across the wave.

## 7. The interrupted-merge marker is retired

A span and its ledger commit reach trunk in one fast-forward, so a death
mid-merge leaves trunk either untouched or with the span shipped; no state
lies between. Nothing writes `<state root>/merging/` any more, the `merging`
entry leaves the state root's runtime ignore set, and `flume loop` no longer
refuses to start (exit 78) over a marker.

**What to do.** Delete a `merging/` directory an older engine left under your
state root, and the `merging/` line in that root's `.gitignore`. A wrapper that
handled `loop`'s marker refusal can drop that branch.

## 8. A gate's child has a deadline and a closed stdin

`supervisorPolicy.gateTimeoutMs` bounds every child the engine runs on a
gate's behalf. The engine supplies no number; the harness package declares 90
minutes, overridable with `supervisor.gateTimeoutMs`. A child past its deadline
is signalled `SIGTERM`, then killed after `killGraceMs`, and the gate fails
naming the deadline and the command. Separately, every captured child's stdin
is ended at spawn: a command that waited on stdin hung the tick on 0.22, and
now reads end-of-file.

**What to do.** If a gate's command legitimately runs longer than 90 minutes,
raise `supervisor.gateTimeoutMs` (a ceiling per child, never a budget for the
gate's total). A gate that read input from stdin takes it from a file or an
argument instead.

## 9. The CLI's narration goes to stderr

Every level of the CLI's operator logger writes to stderr, so stdout carries
only what a verb produced. A tick's dispatch line and summary, and every
supervisor line under `flume loop`, moved.

**What to do.** A script that read those lines from stdout reads stderr, or
redirects `2>&1`. A script piping a verb's own output (`status`, `log --json`,
`render`) now gets it clean. An embedder's `consoleLogger` is unchanged.

## 10. A fanout width that opens no slot is refused

`supervisorPolicy.maxParallel` (harness: `supervisor.maxParallel`) of zero, a
negative or a fraction is refused at chain load, and
`DispatcherOptions.maxParallel` at construction. On 0.22 each tick of such a
run reported a ready queue as a quiet no-op.

**What to do.** Declare a whole number of at least 1, or leave it undeclared
for the default.

## 11. Behavior changes a consumer notices first

- **One entry's failed merge no longer throws its siblings away.** A merge
  failure scoped to one span — a candidate that would not provision, a pick
  that would not read — rows `merge-walled` for that entry and the wave's other
  spans carry on. Only a trunk-scoped failure (the tip read, the claim, the
  fast-forward) stops the wave.
- **A trunk that moved under a merge is absorbed once.** When a writer lands
  on trunk while a candidate is being judged, the span is carried again onto
  the new tip, gates and all; a second mover rows `tip-moved` and the entry
  retries next tick. Committing to trunk mid-run is still best done through
  `flume exclusive -- <command>`.
- **A span row's shas are yours to use.** A span parked, refused or walled
  after its gates passed is never re-picked by the loop; its entry re-runs.
  The verdict's base and head shas survive until gc for a hand
  `git cherry-pick`.
- **An ancestor's gate holds its subtree.** A `blockedBy`, a park or a
  `dependsOnForks` declared on a goal or epic now holds every entry under it.
- **Declared command gates can say more than pass or fail.** Give a `shell` or
  `script` gate a `read` function over its run (stdout, stderr, exit status,
  tree) and it reports a verdict, failing files, `skipped` and `blamesSpan`.
  Declare none and it reports its exit status, as before.
- **`flume wake` names a standing stop flag**, and `wake`, `sleep` and `hold`
  quote the stray positional they refuse.
- **New harness gates.** `rails` refuses a build commit that changes the
  declaration's fence, gates or agents, so build may be fenced to edit the
  declaration's environment without reaching its own rails.
  `new blocker resolves` refuses a plan commit whose new `blockedBy` tag names
  no entry; `TickResult.unresolvedBlockers` reports a blocker tag the queue
  does not carry.
- **The verdict names its tick.** `TickVerdict.tickId` identifies the
  invocation that wrote it.
