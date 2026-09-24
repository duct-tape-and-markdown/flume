# The harness package

Flume ships two things. The **engine** (`@dtmd/flume`) is mechanism: ticks,
worktrees, gates, verdicts, pickability, reported facts, and nothing a second
implementation would want to choose differently (`.claude/rules/engine-boundary.md`).
The **harness package** is flume's opinion about how to run it: the plan slices,
the build phase, their prompts and discipline, the entry extension, the judges,
and the records — shipped beside the engine in the same npm package, adopted by
declaring an environment against it. This file is the harness package's
contract. The engine's own contract is the rest of `spec/`.

The package sits above the engine and below a consumer's declaration:

- The engine imports nothing and knows nothing of the package.
- The package imports the engine and versions with it: an engine minor that
  breaks the chain surface lands with the harness change that absorbs it, so a
  consumer's upgrade is one version bump.
- A consumer imports the package, writes one declaration, and pins one version.
  It never carries a copy of the package's chain, prompts, or judges.

## What the package owns

The package's chain factory returns a complete `Chain` from a declaration. It
owns, and a consumer does not write, one subsection each:

### The phases

Three plan slices — `plan-inbox`, `plan-derive`, `plan-sweep`,
one job each, each running whenever its own window is live — and `build`,
fanout, one entry per worktree. A consumer enables or disables slices; it does
not re-author them. Every phase is a worker: none waits on another's turn, and
what keeps two from treading on each other is mechanism the engine holds — the
entry claim, the ship lock, one file per entry (`spec/pending.md`, *Claims — an
entry in flight is left alone*; `spec/loop.md`, *The ship lock and the worktree
lock — sibling ticks take turns at git*) — never an order the package imposes
on the baton. How many run at once is the consumer's budget,
`supervisorPolicy.maxTicks`, which this repo declares and the package leaves at
the engine's default of one. **Build is declared first**, the plan slices after
it and the sweep last of those: declared order is the priority when the budget
is short, and at the default budget that order is the whole schedule, so the
product outranks insurance for every consumer that declares nothing.

A slice is made live by unrouted work, never by a signal alone: a record in a
queue, a spec commit past the derive cursor, a commit past the sweep stamp. A
tick that runs and files nothing is the shape this sentence exists to refuse.
Two orderings the serial baton used to carry are mechanism now. A refused
entry is not re-picked before the drain reconciles it: the refusal keys on the
entry as declared, and stands until a producer rewrites or drops it (*The
default `handoff`*). And a finding two producers file at once is folded, not
refused: the drain amends the entry that covers it rather than filing a
sibling, and one that reaches build first costs a clean-exit record the next
drain drops (*The gates the discipline needs*).


### The prompts and their discipline

Every prompt the package renders names
the engine's no-commit vocabulary from the engine's own declaration, never a
restated copy, so a rename in the engine cannot strand a prompt. Every key the
package substitutes — its own composed values, a cited spec section, a queue
entry, and a consumer's slot text alike — is declared as data, so the engine
neutralizes inline-exec spans in all of them before it scans
(`spec/prompt.md`, *The render pipeline*): what a prompt quotes reaches the
agent inert, whoever wrote it.


### The entry extension

The fields the package's discipline reads — a summary, a `per` cite, an
acceptance criterion, the `tests[]` and `pins[]` lines the judge proves, a note
to plan, and the contract-touching flag the default handoff stops on — with
their caps and hints, held by the package's schema rather than by a roster
here. A consumer may add fields; it may not remove the package's. A consumer's
field is the same object the package's are — the engine's entry extension, a
schema beside a hint — and the package renders its hint into the plan prompt
through the same renderer as its own, so a consumer's parser and the prompt
that fills it cannot drift either; a consumer never carries a prompt paragraph
for a field it declared.


### The judges

`tests[]` lines are proven green on the merged tree and red on
the base; `pins[]` lines green only. A merged suite red only in files the
span never touched is re-run at the base; failing there too, the judge
refuses with `base-red` rather than blaming the span (`spec/chain.md`, *What
a gate returns*). The judge speaks to the consumer's test runner through the
runner interface below and never assumes vitest.


### The gates the discipline needs

The `per` gate (the cited file is in the
gated commit and the section is a heading in it), the records gate (one file
per record, titled, under the tick's own tag), the
clean-tree gate, the pending gate wired to the consumer's fence, and the
cursor gate: a plan commit's derive cursor is an ancestor of the tip and a
descendant of its pre-commit value, refused otherwise, because a cursor
stepped past commits nobody derived fails silently on every tick after. One
more over the merged tree, because it judges what two concurrent producers did
to one queue: the **claim check** the engine's pending gate carries, refusing
a commit that edits or removes an entry a build tick holds
(`spec/pending.md`, *Claims — an entry in flight is left alone*). It is
`afterMerge` because a pre-merge read passes over exactly the tree the
collision is not in. There is no duplicate gate: two producers filing one
finding is a shape every legitimate decomposition shares, so the drain folds
a duplicate rather than a gate refusing it (*The phases*).
The record byte cap is not the gate's: a note over the cap ships with its entry,
and the drain that reads it says so in the plan commit body — a shape rule on
a prose channel refuses the prose, never the code it rode in with.

No state of the queue needs a hand edit. A queue a gate refuses is plan's to
repair on its next tick, from the tree and the records; a refusal that leaves
the queue in a state only a hand edit clears is a defect in the gate, filed
against it, never a procedure a consumer learns.


### Records as one file each

The inbox and build-note conventions of
`.flume/PROTOCOL.md`, *Records: one file each*, drained by the inbox slice.
A question leaves the questions file by being answered: the record that
closes it carries the ruling and names what the ruling changed, and the
questions file never carries a ruling of its own — so nothing is lost when a
question is re-filed, because the answer lives in the commit that closed it
and in the page it changed, never in the question.

**Presence is state, location is kind, content is for the reader.** A slice
never derives a state from a word: not a status read out of a heading, not a
park read out of a commit's path list, not a kind read out of a note's
prose. The engine already keeps its facts this way — a marker in `awake/`,
the stop flag, the lock, a merging stake, a record per prior attempt under a
directory per keyspace — and the package's own artifacts take the same shape:
open questions are one file each under the plan's `questions/` directory,
present while open and deleted when answered, so any session may add one and
the drain closes one the way it drains a record; a build note that parks its
entry lives under `notes/parked/` and an observation beside it does not, so
the kind is the path and the records gate holds it. The queue is the same
shape — one entry per file (`spec/pending.md`, *The ledger is a directory —
one entry per file*) — and so is the plan state, one file per slice (*Plan
state as declared state*). What a slice needs to
know before it reads a file, it knows from where the file is.


### A tick puts work down

The entry is the goal and the judge's unit; the tick is not the bound. A
build agent that has landed a coherent, green segment of its entry and judges
the rest to be another tick's work commits what it has and writes a
**continuing note** at `notes/continuing/<TAG>.md` — what landed, what is
next, and where the next tick should look — the way a park writes one under
`notes/parked/`. Location is kind (*Records as one file each*): the `shipped`
predicate reads a commit carrying a note at that path as not shipped, so the
entry stays in the queue with its span on the trunk; the judge's named-lines
gate skips the commit as it skips a park, since the lines belong to the
completed entry and not to a segment of it; the per-entry refusal does not
hold the entry, and the handoff routes it back to build rather than to the
drain, since nothing about a continuation is plan's to reconcile. The next
tick on that entry is handed the note beside the prior-attempt record, and
the note leaves with the tick that completes the entry: its ship commit
removes the note with the entry's file.

Continuing is the agent's declaration, never an inference. A tick that runs
out of context, turns, or wall clock without writing one is a preempt, and
its uncommitted work dies with the worktree as it always has. What makes the
declaration reachable is the budget line the adapter hands the agent
mid-session (`spec/chain.md`, *The agent seam*): the build prompt names the
thresholds at which an agent lands what is green and writes the note.

**Why:** a bound the planner chose is right by accident. Measured over the
scheduler's derivation, entries plan sized in ten minutes ran sixty to
seventy-six, and one revert over a single mis-declared line discarded the
longest of them whole. A span with a partial outcome loses at most a segment.
This is an experiment, and the verdict log is where it is judged: reverts and
parks per shipped entry, plan's share of agent time, and the median build
invocation, before and after.

### CI lanes as a findings source

A declared CI lane is a findings source beside the inbox. The inbox slice
reads the latest completed run of the declared workflow job for the tip's
branch through the forge's CLI, takes the failing test titles as findings
keyed by lane name and title, and files or re-files each the way it drains a
record: a title already heading a queue entry or an open question is not
re-filed, and a title the latest run reports green closes in the plan commit
body. A run is durable evidence on the forge, never a process's stdout, so the
slice decides from what the forge holds (`.claude/rules/engine-boundary.md`,
*Told, not inferred*). A lane the slice cannot read — no forge CLI on the host,
no completed run for the tip yet — renders as unread and says so, never as
green.

A lane makes the inbox slice live exactly when its latest completed run for
the tip's branch failed, that run is past the stamp the slice last wrote for
the lane, and — where the lane declares a title reader — its failing-title
set differs from the set the stamp carries. The reader is the consumer's: a
pattern or a function over the run's log, stating the grammar its runner
emits, since the package parses no prose it did not author; a lane that
declares none wakes once per failing run, which is the same rule over an
empty set, spelled rather than inherited. The stamp is the run and the titles
the reader gave it, so a red that persists unchanged
advances the stamp at the next tick that runs anyway and wakes nothing. The
slice stamps the run it woke on, drained or unread, as it
stamps a cursor. So a red lane wakes the slice once per run and never every
tick, a green run needs no drain, and a lane whose status the slice cannot
read makes it live for nothing — unread renders only when the slice is live
for another reason. The render names the lane that made the slice live, so
a tick woken by a run whose log it then cannot fetch says which lane woke it
and that the run went unread; that run is stamped like a drained one, and
its findings arrive from the next run that fails, because the lane runs on
every push and a failure that persists reports again. A stamp is never an
operator's to clear.


### Declared findings sources

A findings source is anything the loop must route or re-buy every tick, and
the declaration names each: the inbox directory, a CI lane (above), and the
friction channel (`spec/chain.md`, *`Chain.friction` — the declared friction
channel*). The inbox slice reads a declared friction directory as it reads
the inbox — one record per file, routed and then removed the way a record is
drained — so a consumer never carries a prompt paragraph for routing its own
notes; a paragraph every consumer would repeat is a surface the package owes
(`.claude/rules/engine-boundary.md`, *Surface, not prescription*).

A measurement a consumer takes every tick — a census of what the tree holds
against what its own records claim — is the consumer's to compute and the
package's to route, and it routes as records: written into the inbox
directory before the tick, drained by the drain the package already runs. It
never rides a prompt slot, which is text, and it never becomes a prompt
paragraph. The package declares no source that runs a consumer's command,
because a mechanism with no consumer is surface someone must excavate later
(`.claude/rules/engineering.md`, *An export earns its consumer*); a second
case for one is the evidence that rules it in.

### Plan state as declared state

The derive and sweep cursors, the continuation signal, and the per-lane
drained-run stamp — the run and the failing titles it reported — are fields
the package reads through its own accessor,
never a line regexed out of prose. **One file per writer**: each slice's state
lives in its own file under the plan's `state/` directory — the derive cursor
in derive's, the sweep cursor and rotation in sweep's, the drained runs in
inbox's — so two slices stamping in one wave merge as disjoint files, and no
slice writes a cursor it does not own. The inbox drain therefore never
advances the derive cursor: a spec commit whose derivation a drained record
routed is still derive's to walk, and the tick that finds its sections already
queued judges them done in the commit body and moves the cursor — one cheap
tick, paid so that no cursor has two hands on it. Absence is read three ways,
on purpose: a
missing plan state renders as no state yet and a missing questions file as
none open, because both are the package's to bootstrap; a missing queue refuses
the render, because a slice re-deriving a queue it could not read would write
over work it never saw — adoption seeds the queue so that refusal is always a
defect.


### The default `handoff`

Reads the engine's reported pickable set and
no-commit facts, and writes exactly one thing: the stop flag, after a shipped
entry marked contract-touching, so the next run starts on the contract it
changed. It wakes every slice whose window is live and build whenever anything
is pickable — all of them in one answer, since which of them run at once is
the budget's decision and not the handoff's; the one exception is the slice
that just ran and committed nothing, which is not re-woken into the same wall.
It never hands build an entry whose latest prior attempt is a refusal a
producer resolves — a clean exit, a park, a merge the queue must answer —
while that record stands against the entry **as declared**: the record keys on
the entry's slug and declared hash, so a producer's rewrite is a new key and
its drop ends the record, and the refusal lifts on exactly the reconciliation
it waited for, never on a tip that happened to move. Read from the mode and
the key the engine reports on the record, never from a heuristic of the
package's own. If the pickable set cannot carry a per-entry refusal a chain
declares, that is a missing engine capability, and the harness is its first
declarer. Two things are the package's floor, beneath any consumer's declared
`handoff`: that refusal, and the stop write after a contract-touching ship. A
declared handoff replaces the wake set above them and runs beneath both,
because re-dispatching an unreconciled entry is the same outcome whoever
schedules the phases, and a resident supervisor absorbing a contract its
children no longer share is the same livelock whoever names the next phase. A
consumer overrides the wake set by declaration, not by copying it.


### Committed-path discipline

Every mechanic the package wires addresses a path some commit holds: the
queue the `per` gate reads at a ref, the record a slice drains, the note a
build tick parks into and `shipped` reads back. The package therefore
requires the state root to resolve inside the repository, and refuses a
relocated root at chain load, naming it — the one engine configuration the
package narrows. The engine supports a root outside the working tree
(`spec/chain.md`, *The package a chain loads through*); a consumer relocating
its root runs the engine without this package's discipline, never a chain
whose every tick silently skips its own gates.

### The runtime ignore set

The ignore lines for the consumer's state root, derived from the engine's path
record plus the package's own per-run artifacts (its session captures) — a
consumer never hand-maintains a list against paths it does not own.

## What a consumer declares

One declaration module beside the consumer's state root — `declaration.ts`,
a TypeScript module, because some of its fields are values with behavior (the
runner, the resolver, a handoff override, a lane's title reader, and the
worktree base) — validated by the package's strict schema at chain
load; an unknown field or a missing required
one refuses the load naming the field and the valid set.

**One declaration, one effort, one checkout.** A repository running a loop
declares once. A repository running several efforts at once gives each one a
checkout of its own, with its own declaration in it — the operator's act
(`git worktree add`), never a partition the package offers. A checkout is
already the unit everything else keys by: the tip a claim is taken on, the
install a `setup` provisions, the fence a build commits under. Splitting an
effort below it buys separate files while leaving execution serialized on
the shared tip, so what varies between efforts — the locus, the fence, the
gates, the agents, the setup — varies per checkout, where a fresh
declaration already resolves.

| Field | What it decides |
| --- | --- |
| `specLocus` | Where a `per` cite may point: a list of path globs (this repo: `spec/**`, `.claude/rules/**`). The `per` gate resolves against it. |
| `fence` | Build's `writablePaths`, and per plan slice the paths that slice may write beyond the package's own plan artifacts. |
| `channelPaths` | Build's `entryChannelPaths`. Optional. |
| `scopeWritesToEntry` | Off by default. The package documents both arguments and takes no side. |
| `runner` | A factory, `({ api, provision }) => Runner`, for the test runner the judge drives — see *The runner interface*. The package calls it at chain load with the chain's own `FlumeApi` and the declared `setup` as a provisioning function, so a runner constructs neither by hand. |
| `resolver` | A section resolver for `per` cites, replacing heading-text resolution — see *The cite resolver*. Optional. |
| `handoff` | A per-phase override of the default handoff — see *The default `handoff`*. Optional, per phase, so overriding build's routing never copies the slice ladder. |
| `gates` | Extra gates per phase and `when`, by registry name, inline shell, or script. A shell or script gate runs in the gate's own tree, under the declared `shell` (its own row), with the engine's gate facts in its environment, `FLUME_`-prefixed — the gated commit, the span's base, the trunk the span landed onto (`FLUME_LANDED_ON_SHA`, `afterMerge` only), the state root and its repo-relative offset, the touched paths — so a gate that measures trunk before and after this entry reads `FLUME_LANDED_ON_SHA` rather than deriving `HEAD^`, which a multi-commit span makes wrong, and a gate that needs what the tick saw reads `FLUME_BASE_SHA`. The package's discipline gates are always present and always first; its judge runs after the consumer's declared gates at the same `when`, so a seconds-long typecheck reports before a minutes-long suite. |
| `agents` | Model per phase, extra agent arguments, the model's context window in tokens (`contextWindow`, forwarded to the adapter's budget line — `spec/chain.md`, *The agent seam*), and whether the tick inherits the user's MCP servers (`inheritUserMcp`, off by default); absent means the package's default. |
| `supervisor` | The engine's supervisor policy, passed through whole — `maxParallel`, `tickTimeoutMs`, `abortThreshold`, `quarantineScope`, `partitionIgnore`, `killGraceMs` — declared here so one file holds the environment and no knob is lost behind the factory. |
| `shell` | The shell every command line the declaration carries runs under — a shell gate's, a script gate's, `setup.restore` — `sh` by default. Chain load refuses a shell the host does not resolve, naming the site that would have run it, since a win32 host resolves `sh` from one launch shell and not another; a bad shell surfaces at load, never hours in as a worktree that would not provision. |
| `setup` | Directories to install and a restore command, run under the declared `shell` in every provisioned worktree, singleton and fanout alike. `serialize: true` runs the restore one worktree at a time across a fanout wave, for a restore whose shared cache is not safe to warm concurrently; the wave's other provisioning stays parallel. `serialize` is a property of the declared restore: a declaration naming no restore has nothing to serialize, parses, and holds nothing — the engine's own install is never what it covers. |
| `slices` | Which plan slices run; the sweep's domain and posture pages. |
| `slots` | Prompt slots the package renders into its prompts: an autonomy dial, domain context. Text only; a slot cannot add a directive the package's discipline already states. |
| `capabilities` | The capabilities this repository asserts, passed through whole to `Chain.capabilities`; an entry that requires one the declaration does not assert is unpickable, and `flume status` names it. Optional; absent asserts none. |
| `ci` | CI lanes the inbox slice reads as findings sources — each a workflow file, a job name, the lane name its findings carry, and optionally a title reader (a pattern or a function over the run's log) that gives the liveness rule its failing-title set — see *CI lanes as a findings source*. Optional. |
| `friction` | The friction directory, state-root-relative, passed through to `Chain.friction` and read by the inbox slice as a findings source — see *Declared findings sources*. Optional; absent disables the channel. |
| `worktreesBase` | Where this consumer's worktrees are planted: a function over the resolved roots answering an absolute directory, passed through whole to `Chain.worktreesBase` (`spec/worktrees.md`, *Placement — the worktree base*). The operator's `FLUME_WORKTREES_DIR` still outranks it. Optional; absent takes the engine's `<flumeDir>/worktrees` default. |

Nothing in the declaration names an engine artifact path, a verdict field, or a
prior-attempt mode. Those are the engine's to report and the package's to read.

## The runner interface

The judge does not know which test tool a consumer runs. A `runner` is a
declared value with three operations, each returning structured results rather
than exit codes the judge would have to interpret:

- **`run(names, cwd)`** — run the tests whose full names contain each of `names`
  and report, per name, whether one passing test carried it.
- **`runAtBase(names, files, baseSha, cwd)`** — lay the merged bytes of `files`
  over a detached checkout of `baseSha` and run the same names there; the judge
  refuses a `tests[]` line that passes here. The checkout is the engine's and is
  reclaimed at the gate boundary, so this operation runs only inside a gate
  invocation; nothing drives it from outside one.
- **`lanes`** — the runner's declared lanes and which files each excludes. The
  running lane's exclusions are rendered into plan's `tests[]` and `pins[]`
  hints, so plan is told at authorship which globs no judge will reach — never
  refused for a prediction, since an entry's `files` is a prediction build is
  not held to.

A runner is declared as a factory over what a base checkout needs and cannot
reach from a static declaration: the engine's API — its lockfile-aware
installer and the state root's worktree base, so a run that dies mid-flight
leaves a directory the stale-worktree sweep reclaims — and the consumer's own
declared `setup`, reduced to a function that provisions a checkout the way a
build worktree is provisioned (the installer at the root when none is declared).
The factory receives both, `(ctx: { api, provision }) => Runner`; the package
ships a vitest runner factory that takes them from what it is given, so a
consumer whose install is not at the repo root judges its base the same way it
builds. It also ships a **script runner** factory for a consumer whose proof
is a validator rather than a test tool: a declared command the package runs
once per operation in the tree under judgment, the named lines as its
arguments, reading its report through a reader the declaration names. The
default reader takes one verdict line per name from stdout — the name,
whether a passing check carried it, and the file that did; a validator that
emits one document declares a reader over that document, a function in the
declaration since the runner is a value with behavior, so the consumer's
wrapper is the package's reader and never a script beside the script. Exit
status is not the verdict; the report is. Every consumer outside the JS test ecosystem was
writing that same script, so it lives beside the vitest one and the runner
row prices honestly. A consumer with cargo, dotnet, or a script declares its own against the
same three operations.

## The cite resolver

`per` is `{ path, section }`. The package resolves it against `specLocus`: the
path must match a declared glob and be present in the gated commit; the section
must head exactly one section in that file at that commit — a text the file
heads twice, sibling or nested, is refused naming both lines, since a cite that
names two sections names neither. A consumer whose spec is typed
(a temper `contract-spec` kind, for example) may declare a resolver that
resolves a section by key rather than by heading text; the gate's verdict shape
is the same either way.

## Adoption and upgrade

`flume-harness init` — a verb on the bin the package ships beside the engine's
`flume`, so the engine's verb set stays closed and never imports the harness —
writes the declaration
skeleton, a `chain.ts` that applies the factory to it (the engine refuses a
load without one), a `package.json` in the state root declaring
`"type": "module"` — the package is ESM-only (`spec/chain.md`), and the chain
loads as ESM whatever the consumer's own manifest says, on every node the
engine supports — the state root with an empty queue in it (nothing else
creates one before the first build wave, and a plan slice refuses over an
absent queue), the ignore set, and `PROTOCOL.md`, and adds the package as the
consumer's dependency. The install smoke runs this verb over the manifest
`npm init` produces and loads the chain it wrote. `init --help` answers with
usage and exits 0 before anything is written. A consumer never copies a
prompt, a slice, or a judge from another consumer; what it wants to change it
declares.

Upgrading is one version bump plus the release's migration note. A
consumer whose state root carries no `package.json` adds the one init writes
— `"type": "module"`, beside `chain.ts` — or its chain stops loading on node
22.23 and later (`.claude/rules/platform-facts.md`); the migration note says
so ahead of any other step, since it is the one that costs a working chain.
A harness
breaking change lands under the same `### Breaking` heading as an engine one
(`spec/cli.md`, *Versioning policy*), and a
breaking change to the declaration schema is refused at load with the field
named, never read as a silent default.

## Where it lives

The package's source is `harness/` at this repository's root, beside `src/`,
and ships as the `./harness` subpath export of `@dtmd/flume` — one npm
package, one version, one `exports` map, so the engine minor and the harness
that absorbs it cannot drift apart and the existing install acceptance covers
both. `harness/` imports `src/`; `src/` never imports `harness/`, and the
second-implementation test (`.claude/rules/engine-boundary.md`) governs `src/`
alone. Its tests live under `tests/` in the same suite, and it is inside the
posture sweep's domain. The package's prompts are markdown files under
`harness/prompts/`, copied beside the emitted `dist/harness/` at build and
covered by the package's `files` allowlist; each phase the package constructs
names its prompt by the absolute path resolved from the package's own location.

The three layers and their two borders — what each owns, how the layer
outside extends it, the test that places a thing, and which way a finding
travels — are stated once for a consumer's reading in `docs/LAYERS.md`; this
page and `.claude/rules/engine-boundary.md` are its sources, and it restates
neither, it points.

## What this repo is

This repo's own `.flume/` is the package's reference consumer: `chain.ts` is the
harness factory applied to `.flume/declaration.ts`, and nothing else. A
prompt, a judge, or a gate this repo wants lives in `harness/`, where every
consumer gets it, never in `.flume/` alone — a chain-side block that only this
repo carries is the same drift the package exists to end (CLAUDE.md, *Source
of truth*).
