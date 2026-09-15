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
one job each, selected by the first live window — and `build`, fanout, one
entry per worktree. A consumer enables or disables slices; it does not
re-author them.


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
here. A consumer may add fields; it may not remove the package's.


### The judges

`tests[]` lines are proven green on the merged tree and red on
the base; `pins[]` lines green only. The judge speaks to the consumer's test
runner through the runner interface below and never assumes vitest.


### The gates the discipline needs

The `per` gate (the cited file is in the
gated commit and the section is a heading in it), the records gate (one file
per record, titled, under the byte cap, under the tick's own tag), the
clean-tree gate, and the pending gate wired to the consumer's fence.


### Records as one file each

The inbox and build-note conventions of
`.flume/PROTOCOL.md`, *Records: one file each*, drained by the inbox slice.


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
the tip's branch failed and that run is past the stamp the slice last wrote
for the lane; the slice stamps the run it woke on, drained or unread, as it
stamps a cursor. So a red lane wakes the slice once per run and never every
tick, a green run needs no drain, and a lane whose status the slice cannot
read makes it live for nothing — unread renders only when the slice is live
for another reason. The render names the lane that made the slice live, so
a tick woken by a run whose log it then cannot fetch says which lane woke it
and that the run went unread; that run is stamped like a drained one, and
its findings arrive from the next run that fails, because the lane runs on
every push and a failure that persists reports again. A stamp is never an
operator's to clear.


### Plan state as declared state

The derive and sweep cursors, the continuation signal, and the per-lane
drained-run stamp are fields the package reads through its own accessor,
never a line regexed out of prose. Absence is read three ways, on purpose: a
missing plan state renders as no state yet and a missing questions file as
none open, because both are the package's to bootstrap; a missing queue refuses
the render, because a slice re-deriving a queue it could not read would write
over work it never saw — adoption seeds the queue so that refusal is always a
defect.


### The default `handoff`

Reads the engine's reported pickable set and
no-commit facts, and writes exactly one thing: the stop flag, after a shipped
entry marked contract-touching, so the next run starts on the contract it
changed. A consumer overrides it by declaration, not by copying it.


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
a TypeScript module, because three of its fields are values with behavior (the
runner, the resolver, and a handoff override) — validated by the package's strict schema at chain
load; an unknown field or a missing required
one refuses the load naming the field and the valid set.

| Field | What it decides |
| --- | --- |
| `specLocus` | Where a `per` cite may point: a list of path globs (this repo: `spec/**`, `.claude/rules/**`). The `per` gate resolves against it. |
| `fence` | Build's `writablePaths`, and per plan slice the paths that slice may write beyond the package's own plan artifacts. |
| `channelPaths` | Build's `entryChannelPaths`. Optional. |
| `scopeWritesToEntry` | Off by default. The package documents both arguments and takes no side. |
| `runner` | A factory, `({ api, provision }) => Runner`, for the test runner the judge drives — see *The runner interface*. The package calls it at chain load with the chain's own `FlumeApi` and the declared `setup` as a provisioning function, so a runner constructs neither by hand. |
| `resolver` | A section resolver for `per` cites, replacing heading-text resolution — see *The cite resolver*. Optional. |
| `handoff` | A per-phase override of the default handoff — see *The default `handoff`*. Optional, per phase, so overriding build's routing never copies the slice ladder. |
| `gates` | Extra gates per phase and `when`, by registry name, inline shell, or script. The package's discipline gates are always present and always first; its judge runs after the consumer's declared gates at the same `when`, so a seconds-long typecheck reports before a minutes-long suite. |
| `agents` | Model per phase, extra agent arguments, and whether the tick inherits the user's MCP servers (`inheritUserMcp`, off by default); absent means the package's default. |
| `supervisor` | The engine's supervisor policy, passed through whole — `maxParallel`, `tickTimeoutMs`, `abortThreshold`, `quarantineScope`, `partitionIgnore`, `killGraceMs` — declared here so one file holds the environment and no knob is lost behind the factory. |
| `setup` | Directories to install and a restore command, run in every provisioned worktree, singleton and fanout alike. |
| `slices` | Which plan slices run; the sweep's domain and posture pages. |
| `slots` | Prompt slots the package renders into its prompts: an autonomy dial, domain context. Text only; a slot cannot add a directive the package's discipline already states. |
| `ci` | CI lanes the inbox slice reads as findings sources — each a workflow file, a job name, and the lane name its findings carry — see *CI lanes as a findings source*. Optional. |

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
builds. A consumer with cargo, dotnet, or a script declares its own against the
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
load without one), the state root with an empty queue in it (nothing else
creates one before the first build wave, and a plan slice refuses over an
absent queue), the ignore set, and `PROTOCOL.md`, and adds the package as the
consumer's dependency. A consumer never copies a prompt, a slice,
or a judge from another consumer; what it wants to change it declares.

Upgrading is one version bump plus the release's migration note. A harness
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

## What this repo is

This repo's own `.flume/` is the package's reference consumer: `chain.ts` is the
harness factory applied to `.flume/declaration.ts`, and nothing else. A
prompt, a judge, or a gate this repo wants lives in `harness/`, where every
consumer gets it, never in `.flume/` alone — a chain-side block that only this
repo carries is the same drift the package exists to end (CLAUDE.md, *Source
of truth*).
