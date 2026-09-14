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
owns, and a consumer does not write:

- **The phases.** Three plan slices — `plan-inbox`, `plan-derive`, `plan-sweep`,
  one job each, selected by the first live window — and `build`, fanout, one
  entry per worktree. A consumer enables or disables slices; it does not
  re-author them.
- **The prompts and their discipline.** Every prompt the package renders names
  the engine's no-commit vocabulary from the engine's own declaration, never a
  restated copy, so a rename in the engine cannot strand a prompt.
- **The entry extension.** `summary`, `per`, `acceptance`, `tests[]`, `pins[]`,
  `notes`, with their caps and hints. A consumer may add fields; it may not
  remove these.
- **The judges.** `tests[]` lines are proven green on the merged tree and red on
  the base; `pins[]` lines green only. The judge speaks to the consumer's test
  runner through the runner interface below and never assumes vitest.
- **The gates the discipline needs.** The `per` gate (the cited file is in the
  gated commit and the section is a heading in it), the records gate (one file
  per record, titled, under the byte cap, under the tick's own tag), the
  clean-tree gate, and the pending gate wired to the consumer's fence.
- **Records as one file each.** The inbox and build-note conventions of
  `.flume/PROTOCOL.md`, *Records: one file each*, drained by the inbox slice.
- **Plan state as declared state.** The derive and sweep cursors and the
  continuation signal are fields the package reads through its own accessor,
  never a line regexed out of prose.
- **The default `handoff`.** Reads the engine's reported pickable set and
  no-commit facts. A consumer overrides it by declaration, not by copying it.
- **The runtime ignore set** for the consumer's state root, derived from the
  engine's path record.

## What a consumer declares

One declaration file beside the consumer's state root, validated by the
package's strict schema at chain load; an unknown field or a missing required
one refuses the load naming the field and the valid set.

| Field | What it decides |
| --- | --- |
| `specLocus` | Where a `per` cite may point: a list of path globs (this repo: `spec/**`, `.claude/rules/**`). The `per` gate resolves against it. |
| `fence` | Build's `writablePaths`, and per plan slice the paths that slice may write beyond the package's own plan artifacts. |
| `channelPaths` | Build's `entryChannelPaths`. Optional. |
| `scopeWritesToEntry` | Off by default. The package documents both arguments and takes no side. |
| `runner` | The test runner the judge drives — see *The runner interface*. |
| `gates` | Extra gates per phase and `when`, by registry name, inline shell, or script; the package's own gates are always present and always first. |
| `agents` | Model per phase and extra agent arguments; absent means the package's default. |
| `supervisor` | `maxParallel`, `tickTimeoutMs`, `abortThreshold`, `partitionIgnore` — the engine's supervisor policy, declared here so one file holds the environment. |
| `setup` | Directories to install and a restore command, run in every provisioned worktree, singleton and fanout alike. |
| `slices` | Which plan slices run; the sweep's domain and posture pages. |
| `slots` | Prompt slots the package renders into its prompts: an autonomy dial, domain context. Text only; a slot cannot add a directive the package's discipline already states. |

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
  refuses a `tests[]` line that passes here.
- **`lanes`** — the runner's declared lanes and which files each excludes, so
  the judge can refuse at plan time a line homed in a lane it will not run,
  instead of at build time after a wave.

The package ships a vitest runner. A consumer with cargo, dotnet, or a script
declares its own against the same three operations.

## The cite resolver

`per` is `{ path, section }`. The package resolves it against `specLocus`: the
path must match a declared glob and be present in the gated commit; the section
must be a heading in that file at that commit. A consumer whose spec is typed
(a temper `contract-spec` kind, for example) may declare a resolver that
resolves a section by key rather than by heading text; the gate's verdict shape
is the same either way.

## Adoption and upgrade

`flume init` (a verb of the package, not the engine) writes the declaration
skeleton, the state root, the ignore set, and `PROTOCOL.md`, and adds the
package as the consumer's dependency. A consumer never copies a prompt, a slice,
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
posture sweep's domain.

## What this repo is

This repo's own `.flume/` is the package's reference consumer: `chain.ts` is the
harness factory applied to `.flume/declaration.json`, and nothing else. A
prompt, a judge, or a gate this repo wants lives in `harness/`, where every
consumer gets it, never in `.flume/` alone — a chain-side block that only this
repo carries is the same drift the package exists to end (CLAUDE.md, *Source
of truth*).
