# Flume

A disciplined harness for AI-derivation pipelines. One tick = one phase × one
agent invocation = one commit (or zero). The harness enforces output shape,
capability scoping, validation gates, and baton mechanics; prompts say what the
agent produces, not what discipline to remember.

## What it is

Flume turns a prose multi-stage AI pipeline into a typed declarative chain.
Each `Phase` is a typed declaration — prompt template, writable paths,
concurrency mode, gates, handoff rules. The dispatcher runs one tick at a
time, validates the resulting commit, and signals the next phase to wake.

Each tick is stateless. The agent invocation reads committed artifacts from
disk; there is no in-memory continuity. If a commit fails a gate, the harness
reverts and the phase re-runs against the same input plus the validation
error.

## Posture

- **Disk is truth.** Every tick is a fresh agent invocation reading committed
  artifacts. No sessions, no in-memory continuity.
- **Stateless ticks.** One tick = one phase × one agent invocation = one
  commit (or zero).
- **Harness enforces, prompts state.** Validation gates, capability scoping,
  output shape, and baton mechanics live in the harness. Prompts say what the
  agent produces, not what discipline to remember.
- **Conservative derivation.** A derived layer never invents intent absent
  from its source.
- **Structured handoff.** Inter-phase contracts are JSON schemas, not prose
  conventions. Markdown is reserved for documentation and prose surfaces.

## Quickstart

```bash
npm install --save-dev @dtmd/flume
```

Flume is exec-local: a bay declares `@dtmd/flume` as its own dependency
and invokes it through the package manager (`pnpm exec flume`, an npm
script, `npx flume`). The binary that runs is always the bay's pinned
copy, and a chain's `import "@dtmd/flume"` resolves to that same
copy — one engine per bay, coherent by construction. Global installs
are unsupported; the engine makes no attempt to detect or accommodate
one.

Drop a `.flume/chain.ts` into your repo:

```ts
// .flume/chain.ts
import type { Chain, Phase } from "@dtmd/flume";
const echo: Phase = { name: "echo", description: "Hello-world tick: write a note to disk.", promptPath: "prompts/echo.md", concurrency: "singleton", writablePaths: ["notes/**"], gates: [], handoff: () => [] };
const chain: Chain = { phases: [echo], humanOnly: [] };
export default chain;
```

Author `.flume/prompts/echo.md` — the prompt template (Markdown plus
`{{KEY}}` placeholders from `promptArgs`). Then:

```bash
npx flume tick      # one phase × one agent invocation
npx flume status    # baton state
npx flume loop      # tick until hibernation
```

For a readable single-phase starter with each field on its own line, see
[`examples/minimal-chain.ts`](examples/minimal-chain.ts). For multi-phase
pipelines (workshop → spec → plan → build), copy
[`examples/cascade-chain.ts`](examples/cascade-chain.ts) instead.

## The chain

A `Chain` is an ordered list of `Phase`s. Each `Phase` declares:

- **`prompt`** — a template rendered against `TickContext` (committed files,
  baton state, pending entries).
- **`writablePaths`** — globs the agent's commit must fit inside. Anything
  outside reverts the commit.
- **`concurrency`** — `"singleton"` (one tick per phase per cycle) or
  `"fanout"` (multiple parallel ticks across disjoint pending entries).
- **`gates`** — typecheck, tests, lint, custom — each declared `afterCommit`
  (per-tick) or `afterMerge` (post-fanout).
- **`handoff`** — which phase(s) wake after a successful commit.

The pending entries themselves are typed. A plan-style phase emits
`.flume/plan/pending.json`; the schema (`PendingEntry`, `PendingList`) is the
contract between plan and build. Built-in gates (`tscGate`, `vitestGate`,
`eslintGate`, `writablePathsGate`) cover the common cases; custom gates are
plain functions returning `GateResult`.

## Chain residency

**One chain per `.flume`.** The chain lives at `<configDir>/chain.ts`, and
job resolution never retargets `configDir` — `--job`/`FLUME_JOB` move only
the mutable state root (`.flume` → `.flume/jobs/<name>`), never which chain
governs the tick. There is no job-local chain: every job under a repo ticks
the one repo-resident chain, from whichever branch happens to be checked
out.

Per-job variation is already served, twice over:

- **A job is a branch.** Edit `.flume/chain.ts` on `job/<name>` and the
  variation lives and dies with that branch — linked worktrees give
  concurrent divergence, since each resolves its own checkout's chain.
- **A chain is code.** `FLUME_JOB` is written back into the environment
  before the chain loads, so one repo chain can dispatch on the job name
  itself.

A `chain.ts` sitting inside a job dir — left over from an older layout, or
hand-placed — is simply inert: the runtime never looks there, and nothing
polices it. `.flume/jobs/<name>/` holds job *state*; the chain that governs
every job is always the repo's own `.flume/chain.ts`. Thin job dirs plus one
static, repo-resident chain is the native shape — not a convention layered
on top.

## Concurrency

Phases declared `concurrency: "fanout"` partition their pending entries by
file overlap (`partitionByFileOverlap`). Disjoint entries spawn parallel
worktrees; each worktree runs its agent invocation and `afterCommit` gates in
isolation. When the wave finishes, the dispatcher merges into the trunk in
commit order and runs `afterMerge` gates against the merged state. A cherry-pick
conflict keeps that entry in pending; an `afterMerge` failure reverts the
whole wave.

Worktree branches are named `flume/<entry-slug>`; under a job (below) they
are namespaced `flume/<job>/<slug>`, so two jobs sharing an entry tag never
clobber each other's branches.

Worktrees are the only isolation primitive in v0.1. Docker / sandbox layers
are deferred.

## Where state lives

Everything is on disk under `.flume/`:

- `.flume/awake/<phase>` — baton flag files. Presence = phase is awake.
- `.flume/plan/pending.json` — structured handoff between plan and build.
- `.flume/plan/state.md`, `.flume/plan/open-questions.md` — prose scratch
  that survives across ticks.
- `.flume/inbox.md` — transient findings queue drained by plan.
- `.flume/worktrees/<entry-slug>/` — per-entry worktrees during fanout. The
  base dir is overridable via `FLUME_WORKTREES_DIR` (below).
- `.flume/loop.pid` — cross-process loop lock, present while a `flume loop`
  runs against this state root (below).
- `.flume/sessions/<timestamp>.jsonl` — captured agent NDJSON (opt-in via
  `withSessionCapture`).

Ticks read these on entry and write them on commit. Across ticks, the disk is
the only carrier of state.

### Relocating state: `FLUME_DIR` / `FLUME_CONFIG_DIR`

The two halves of `.flume/` relocate independently via env vars:

- **`FLUME_DIR`** moves the **mutable state** — the baton (`awake/`), pending
  (`plan/`), worktrees (`worktrees/`), prior-attempt records
  (`prior-attempts/`), and session logs (`sessions/`).
- **`FLUME_CONFIG_DIR`** moves the **chain + prompts** — `chain.ts` and the
  prompt files it references.

Both default to `<repoRoot>/.flume`. A set-but-relative value resolves against
the cwd. They cross the `loop`→`tick` process boundary by inheritance: the
supervisor's `flume tick` children run with no `env:` override, so they see the
same resolved values.

This buys an **attach-work-detach** posture: point `FLUME_DIR` at a tmpdir
outside the working tree, run the loop, and tear the whole footprint down with a
single `rm` — no state bleeds into `<repoRoot>/.flume`.

```bash
export FLUME_DIR="$(mktemp -d)/flume-dock"
flume loop                  # baton, pending, worktrees, sessions all under FLUME_DIR
rm -rf "$(dirname "$FLUME_DIR")"   # one rm removes the whole dock
```

A relocated **dock is expected to live outside the repo** (e.g. a tmpdir), so
`.gitignore` needs no change: the default `<repoRoot>/.flume` stays ignored as
today, and an out-of-tree dock is invisible to git by construction. The one-`rm`
guarantee holds only if every per-run artifact your chain writes also lives
under `FLUME_DIR` — see
[`docs/CHAIN-AUTHORING.md`](docs/CHAIN-AUTHORING.md) for the chain-author
requirement.

### Relocating fanout worktrees only: `FLUME_WORKTREES_DIR`

Fanout worktrees default to `<flumeDir>/worktrees` — inside the state root, so
they move with `FLUME_DIR` and are covered by the one-`rm` teardown.
`FLUME_WORKTREES_DIR` overrides just the worktree base, resolved as
`FLUME_WORKTREES_DIR ?? join(flumeDir, "worktrees")`; a relative value resolves
against the cwd.

The override exists for one specific hazard: an agent whose working directory
*contains the root checkout's path as a prefix* (the default
`<repoRoot>/.flume/worktrees/<entry>` does) can derive the root from its own
cwd and operate there instead of in its worktree — a stray write the
writable-paths guard never sees, because it lands outside the worktree being
diffed. Pointing `FLUME_WORKTREES_DIR` at a directory outside every repo-path
prefix (e.g. a sibling tmpdir) removes the vector. If you relocate worktrees
outside `FLUME_DIR`, they leave the one-`rm` footprint — they are ephemeral
(created and removed per wave), but a crashed run can strand one there.

### One loop per state root

`flume loop` writes its pid to `<flumeDir>/loop.pid`. A second loop started
against the same state root is refused (exit 1, naming the holder's pid) while
the recorded pid is alive — two supervisors racing one baton would corrupt
plan/build state. A stale pidfile left by a dead process is reclaimed
automatically, and the lock is dropped on normal exit, `SIGINT`, and `SIGTERM`,
so no manual cleanup is ever required.

The lock lives under `flumeDir`, not the repo: the state root is the resource
that races, and a dock relocated via `FLUME_DIR` carries its lock with it —
two loops against *different* docks over the same repo are allowed.

## Trunk contract: HEAD is truth

Commits land on the checked-out branch of the working tree the loop runs in.
Singleton ticks commit to HEAD; fanout waves cherry-pick back onto HEAD. The
runtime never switches branches — there is no trunk configuration to point it
elsewhere. Checkout is a human act (or a job verb's, below): whatever branch
is checked out when the loop starts is the branch the run ships to.

## Jobs

A job is a branch plus a state root, both named by convention:
`.flume/jobs/<name>/` (tracked; runtime subdirs gitignored) on branch
`job/<name>`. The `flume job` verbs are thin sugar over the relocation seams
above — `flume --job <name> <cmd>` (or `FLUME_JOB=<name>`) resolves
`FLUME_DIR` to the job dir; `FLUME_CONFIG_DIR` stays at `<repoRoot>/.flume`
(chains are repo-resident — see "Chain residency" above) unless you set it
explicitly, which composes rather than conflicts. Only `--job` plus an
explicit `FLUME_DIR` is a usage error — two authorities for one state root.
The mutating subcommands (`tick`, `loop`) refuse to run unless HEAD is
`job/<name>`. Everything a job does is expressible with the raw seams; the
verbs just name the convention.

The flow is **`new` → tune → `run` → `rm` or `extract`**:

```bash
flume job new docs-refresh
# tune: edit .flume/jobs/docs-refresh/ (state only — no chain.ts of its own)
flume job run docs-refresh --max 20
flume job status                   # awake phases + pending count per job
```

`job new` branches `job/<name>` off the current HEAD, loads the repo chain
(no chain at `<configDir>/chain.ts` is a usage error — a job that could never
`run` must not be creatable), and copies its declared `Chain.seedDir`, if
any, into the state root verbatim, skip-existing — a re-run fills gaps (a
stub added to the seed dir reaches jobs already created) without ever
clobbering a worked file; see
[`docs/CHAIN-AUTHORING.md`](docs/CHAIN-AUTHORING.md) for what the chain
declares versus what the runtime provisions unconditionally. No `seedDir`
declared → a bare job, no warning: state accretes from ticks, and bare is
legitimate. `job run` wakes the chain's entry phase — `chain.phases[0]`, by
convention — iff the baton is hibernating (a mid-flight job resumes
untouched), then runs the standard loop under the job resolution.

### Two endings

A finished job ends one of two ways; both leave integration to you:

- **`flume job rm <name>`** — the discard ending: throw the harness away,
  keep the work. Removes the job dir with a cleanup commit on `job/<name>`;
  the branch survives, harness commits and all. Right when you hold merge or
  squash rights over the target and can integrate the branch yourself.
- **`flume job extract <name> --onto <base> [--intake <path>]...`** — the
  clean-history ending: fork `<name>` off `--onto` and cherry-pick over only
  the non-harness commits, intake files passing through first as one commit.
  Harness commits never appear on the result — for deliverables where squash
  rights are absent. Before the job is consumed, extract harvests whatever
  paths the repo chain declares via `Chain.harvest` (job-dir-relative) off
  the job branch tip to stdout for operator routing — an undeclared or
  absent `harvest` means nothing is harvested, no default. Extract consumes
  the job (branch and harness dir are gone afterwards); a cherry-pick
  conflict unwinds fully and leaves the job intact for retry.

Full per-verb contracts — steps, refusals, exit codes — in
[`docs/CLI.md`](docs/CLI.md).

### Concurrent jobs: one working tree per job

**One loop per working tree.** Singleton ticks, fanout cherry-picks, and
merge-gate reverts all mutate the working tree's HEAD; two loops in one
checkout race it. The `loop.pid` lock guards state roots, not working trees —
per-job state roots mean two jobs' loops never share a lock, so HEAD
occupancy is the operator-visible signal to respect.

To run jobs concurrently, give each its own working tree:

```bash
git worktree add .git/flume-jobs/docs-refresh job/docs-refresh
cd .git/flume-jobs/docs-refresh
flume job run docs-refresh
```

The `.git/` placement is legal and keeps the worktree out of the main
checkout without a `.gitignore` entry. Cross-job contention on git's shared
`.git/worktrees` metadata is accepted: a race fails one git command → one
tick, the entry stays pending, and the stateless-tick loop retries.
Overlapping `writablePaths` across concurrent jobs is operator
responsibility.

## Status

**v0.1** — stable enough to depend on for a project that lives ≥3 months
without rework. The four core types (`Phase`, `Chain`, `Gate`, and the
pending entry schema) carry the v0.x compatibility line.

Pre-1.0 ships minor-version breaking changes when the public API surface
needs to shift; patch versions never break. Each break lands with a
`### Breaking` entry in [`CHANGELOG.md`](CHANGELOG.md). Stabilization at 1.0
follows enough usage signal to commit under semver.

## Pointers

- [`docs/INTENT.md`](docs/INTENT.md) — design rationale: the spine, what
  stays prose, what becomes JSON, non-goals.
- [`docs/MIGRATING-0.8.md`](docs/MIGRATING-0.8.md) — upgrade checklist for a
  pre-0.8 chain moving onto `@dtmd/flume@0.8.0`.
- [`examples/minimal-chain.ts`](examples/minimal-chain.ts) — single-phase
  starter.
- [`examples/cascade-chain.ts`](examples/cascade-chain.ts) — multi-phase
  workshop → spec → plan → build pipeline.

## License

MIT. See [`LICENSE`](LICENSE).
