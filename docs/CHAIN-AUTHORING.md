# Authoring a Flume chain

> **Current reference.** Describes flume as it ships now; every spec cite
> names a live `spec/*.md` section.

The long-form walkthrough for writing your own `.flume/chain.ts`; assumes
you've read the README. Most repositories should adopt the harness package
instead of writing one — see *First: do you need to write one?* below before
you start. The running example,
[`examples/cascade-chain.ts`](../examples/cascade-chain.ts), is a
plan → build derivation pipeline modelled on the one this repo runs on
itself — every section quotes a slice, so open it in a second pane. For the
bare-minimum shape (no fanout, no plan/build split), see
[`minimal-chain.ts`](../examples/minimal-chain.ts).

**`examples/` is the shipped floor.** The examples arrive in the package and
the suite pins their shape, so every shape quoted below is one you can copy
and run today. The chain flume develops flume with is no longer one of them:
[`.flume/chain.ts`][living] in the flume repository is the harness package's
factory applied to [`.flume/declaration.ts`][living-declaration] and nothing
else — an import and one call, declaring no phase, no gate and no fence of
its own (see the next section). What moves first is [`harness/`][living-harness], the package
itself: it imports the runtime from `src/` rather than from a published
`@dtmd/flume`, so a breaking engine change lands together with the harness
change that absorbs it in the same commit, while an example adopts the new
shape later as its own change. Expect the package to be ahead of both the
examples and this page. Neither the examples nor the package is an engine
default — a recommended shape ships by name, opted into (`.claude/rules/engine-boundary.md`, *Surface, not
prescription*).

[living]: https://github.com/duct-tape-and-markdown/flume/blob/main/.flume/chain.ts
[living-declaration]: https://github.com/duct-tape-and-markdown/flume/blob/main/.flume/declaration.ts
[living-harness]: https://github.com/duct-tape-and-markdown/flume/tree/main/harness

**Two example chains, one engine.** Cascade is the flagship: multi-phase,
fanout, `pending.json`, the full derivation pipeline — but it is *an*
example, not the engine's assumption. The engine ships mechanism, never
convention (`.claude/rules/engine-boundary.md`), and the second example
chain is the proof:
[`examples/backlog-groomer-chain.ts`](../examples/backlog-groomer-chain.ts)
is single-phase, has no plan/build split, and reads a plain
`BACKLOG.json` instead of `pending.json` — yet it composes the same
entry-schema, tag-refinement, and capability-gating machinery cascade uses
(§§10-11 below), declared as its own small extension and its own tag
convention. Where a section below quotes cascade, skim the groomer file
too; the two disagree on shape everywhere the engine lets them, and agree
on nothing the engine doesn't enforce.

## First: do you need to write one?

**Probably not.** Flume publishes two things in one npm package, and only
the first of them is what this page documents:

- **The engine** — `@dtmd/flume`, the package root. Mechanism: ticks,
  worktrees, gates, verdicts, pickability, reported facts. It has no opinion
  about phases, prompts, or what a queue entry means.
- **The harness package** — `@dtmd/flume/harness`, the `./harness` subpath of
  the same package, the same version, the same `exports` map. Flume's opinion
  about how to run the engine, shipped beside it: three plan slices
  (`plan-inbox`, `plan-derive`, `plan-sweep`), a fanout `build` phase, their
  prompts and discipline, the entry extension (`summary`, `per`,
  `acceptance`, `tests[]`, `pins[]`, `notes`), the judge that proves a
  `tests[]` line green on the merged tree and red on the base, the
  discipline gates that run ahead of whatever a consumer declared
  (`records`, `clean-tree`, `pending-gate`, `per cites resolve`,
  `derive cursor`), the records conventions, and the plan state as
  typed state rather than prose a cursor is regexed out of.

One package, one version: an engine minor that breaks the chain surface ships
with the harness change that absorbs it, so a consumer's upgrade is one bump.
`spec/harness.md` is the package's contract; the rest of `spec/` is the
engine's, and this page walks the engine's.

### Adopting: `flume-harness init`

The package ships its own bin beside the engine's `flume`, so the engine's
verb set stays closed and `src/` never imports the harness:

```sh
# adopt, then install what the adoption declared
npx --package @dtmd/flume flume-harness init
pnpm install            # or npm / yarn

# already installed? the local shim is the same verb
pnpm exec flume-harness init
```

What the verb writes, what it refuses over, what it leaves exactly as it
found it, and the exit code each outcome carries is
[`docs/CLI.md` § `flume-harness init`](CLI.md#flume-harness-init) — read off
the bin itself and gated there, so it is the copy to trust.

The `chain.ts` it writes is the whole hop, identical in every repository that
adopts the package, and nothing in it is yours to tune:

```ts
import type { ChainFactory } from "@dtmd/flume";
import { harnessChain } from "@dtmd/flume/harness";

import { declaration } from "./declaration.js";

const factory: ChainFactory = (api) => ({
  chain: harnessChain({ api, declaration }),
});

export default factory;
```

The declaration rides in unparsed on purpose: the schema's refusal is a fact
of chain load, not of every consumer remembering to call `parseDeclaration`.

### "Declaration" names two different things

Everywhere else on this page, **declaring** is what the `Chain` object you
write does — `writablePaths`, `gates`, `concurrency`, `entryExtension`,
`supervisorPolicy`. Those are engine fields, set by your factory. Under the
harness package the word also names a file, and the two are different layers:

| | The harness declaration | The engine-level `Chain` fields |
| --- | --- | --- |
| Where | `<stateRoot>/declaration.ts`, one module exporting one object | the object your `ChainFactory` returns |
| Who writes it | the consumer — it is their *entire* authored surface | the consumer, when hand-authoring; `harnessChain` otherwise |
| Validated by | the package's strict schema at chain load | the engine's chain resolver |
| Documented in | `spec/harness.md`, *What a consumer declares* | §§1–11 below |

The harness declaration's four required fields are `specLocus` (the path
globs a `per` cite may point into), `fence` (build's `writablePaths`, and per
plan slice what that slice may write beyond the package's own plan
artifacts), `runner` (a factory for the test runner the judge drives —
`vitestRunner()` and `scriptRunner()` both ship in the package; cargo, dotnet
or a tool neither one reaches is your own `RunnerFactory` over `Runner`'s
operations, which is adoption's largest single piece and is priced under
*What adoption costs* below), and `slices` (which plan slices run,
and the sweep's domain). Optional: `channelPaths`, `scopeWritesToEntry` (off
by default, and the package takes no side), `resolver`, `handoff` per phase,
`gates` per phase and `when`, `shell` (the shell every command line the
declaration carries runs under — a `shell` or `script` gate's, `setup`'s
restore — `sh` where the declaration is silent), `agents`,
`supervisor` (the engine's policy passed through whole), `setup` (the
directories to install and the restore command that installs them, run in
every provisioned worktree; `serialize: true` where that restore's shared
cache is not safe to warm from several worktrees at once, which runs it one
worktree at a time across a fanout wave while the wave's other provisioning
stays parallel), `slots`
(prompt text — an autonomy dial, domain context; never a directive),
`capabilities` (the environment facts this repository asserts, passed through
whole to `Chain.capabilities`, so a `requiresCapability` entry naming one the
declaration does not assert stays unpickable; absent asserts none), and `ci`
(the CI lanes the inbox slice reads as findings sources beside the records —
each a workflow file, a job name, the lane name its findings carry, and
optionally `titles`: a pattern or a function over the failing job's log
answering the titles that log states, which the slice stamps beside the run
so a red that persists unchanged stops re-waking it; a lane declaring none
wakes the slice once per failing run), and `friction` (the state-root-relative
directory naming the engine's friction channel, passed through whole to
`Chain.friction`; declared here rather than left to the engine because it is
a findings source — the inbox slice reads its files as it reads the inbox,
one record per file, and routes and removes each the same way).

It is a TypeScript module rather than JSON because three of those fields are
values with behavior. An unknown field, or a required one missing, refuses
the chain load naming the field and the valid set. Nothing in it names an
engine artifact path, a verdict field, or a prior-attempt mode: those are the
engine's to report and the package's to read.

#### What a declared command gate's child reads

A `shell` or `script` gate in `gates` runs in the gate's own tree through the
shell the declaration names — `shell`, which is `sh` where the declaration is
silent — with the engine's gate facts already in its environment, so the
command reads what the tick knows instead of rebuilding it from git:

| Variable | What it carries |
| --- | --- |
| `FLUME_COMMIT_SHA` | The commit under inspection — the tip of the gated span. |
| `FLUME_BASE_SHA` | The sha the span started from: the tree as the tick saw it when it branched. |
| `FLUME_LANDED_ON_SHA` | Under `afterMerge`, the trunk tip this span landed onto. **Unset under `afterCommit`**, where no trunk is involved. |
| `FLUME_STATE_ROOT` | The absolute state root — where the queue, the plan state and the records live. |
| `FLUME_STATE_ROOT_REL` | That root's repo-relative offset, forward-slashed for git. Unset when the state root is relocated outside the repository. |
| `FLUME_TOUCHED_PATHS` | The span's changed paths, one per line, repo-relative and forward-slashed; empty when the span touched nothing. |

A gate that measures trunk before and after one entry — a count that may not
grow, a file that may not reappear — reads `FLUME_LANDED_ON_SHA` for its
*before*. `HEAD^` is right only while a span lands as one commit, and a
fanout entry's may be several; `FLUME_BASE_SHA` is what the tick *saw*, which
every sibling in a wave shares.

Name the `shell` your commands are written for. It is every command line the
declaration carries, not the gates alone: `setup`'s restore runs under it
too, in the same `-c` form. `sh` is the default because a POSIX host resolves
it and the commands most consumers write are POSIX; which shells a win32 host
resolves depends on what put them on PATH, so a consumer whose gates run
there declares the one it installed — `bash`, or an absolute path to it. The
declared shell is probed once at chain load, and a shell this host will not
run refuses the load naming the line that declared a command for it, rather
than reporting itself as that gate failing on the tick that first reached it
— or as every worktree in a wave failing to provision.

### What adoption costs

A consumer enables or disables slices; it does not re-author them, and there
is no seam for a phase, prompt or judge of its own — what it wants to change,
it declares. It never copies a prompt, a slice, or a judge from another
consumer. The package also narrows exactly one engine configuration: it
requires the state root to resolve inside the repository and refuses a
relocated root at chain load, because every mechanic it wires addresses a path
some commit holds.

**The runner is the largest single piece**, and the only one whose size
depends on your stack rather than on the package. Two stacks pay a
declaration and nothing further. A vitest suite declares
`runner: vitestRunner()`. A consumer whose proof is a validator it can run as
one command declares `runner: scriptRunner({ command })`: the package runs
that command once per operation in the tree under judgment with the named
lines as its arguments, and reads its report off stdout. Exit status is not
the verdict; the report is. Undeclared, the reader takes one verdict line per
name — the name, whether a passing check carried it, and the file that did;
what such a line looks like is on `scriptRunner`'s own hover text, which is
where it is spelled. A validator that already writes one document declares
`read` beside the command — a function over the whole of that stdout,
answering the names it was handed — and ships no wrapper script for the
package to run instead. Either way the answers are reconciled against the
requested names: one missing, one twice, or one nobody asked about is refused
rather than read as a name nothing carried.

Anything else — cargo, dotnet, a tool that answers to no such command —
authors a `RunnerFactory`: `(ctx) => Runner`, called once at chain load, over
the operations below. The work is not the signatures, it is what they return.

- `run` reports structured results and never an exit code: a passed count for
  the judge's vacuity check, per requested line whether one passing test
  carried it and in which files, and per failure the file it was attributed to.
  A tool that cannot name tests and attribute failures machine-readably needs
  an adapter written before it can be declared at all — and where that adapter
  can be one command plus a function over what it prints, `scriptRunner()` is
  it, already written.
- `runAtBase` lays the working-tree bytes of the judged files over a detached
  checkout of a base sha and runs the same names there — a provisioned
  checkout, and in a compiled language a build, per judged entry. That
  recurring cost is usually the deciding one.
- `lanes` is declared rather than discovered, and the running lane's exclusions
  become plan's authorship hints.

`Runner`, `RunnerFactory`, `RunnerContext`, `RunResult`, `NamedResult`,
`TestFailure` and `Lane` are exported from `@dtmd/flume/harness`, and
`vitestRunner()` and `scriptRunner()` are two working implementations of
`Runner` to read against — one over a tool's report, one over a command's
stdout, whose `ScriptReader` and `ScriptReport` are exported beside them.
`runner` is a required field, so there is no adopting now and porting the
runner later.

So the shape is fixed: a plan → build derivation pipeline over a
`pending.json` queue, with citation discipline and a named-lines judge.

**Read the rest of this page when that shape isn't yours** — a different
workflow, a single phase, a different queue, a chain embedded in something
larger. `examples/backlog-groomer-chain.ts` is exactly that case, and the
engine underneath is the same engine either way.

## Where the chain lives

The harness re-resolves `.flume/chain.ts` (relative to your repo root) at
the start of every tick — disk is truth, so a tick that rewrites the chain
is governed by the new chain on the next tick. The reload mechanism is a
process boundary: `flume loop` is a supervisor that spawns one `flume tick`
child process per iteration, and each child loads the chain exactly once at
its start. There is no in-process memoization or cache-bust — one
`tsImport` of `chain.ts` per tick, a cost dominated by orders of magnitude
by the tick's own agent invocation.

**Default-export a factory** — `(api) => ({ chain })`, where `api` carries
every engine value your chain composes with (gates, agent constructors,
schema helpers) plus `api.paths` — the runtime's own resolved
`{ repoRoot, configDir, flumeDir }`, absolute, by reference, and beside them
`stateRootRel`, the state root's offset from the repo root in git's alphabet
(`undefined` when the root is relocated outside the repo). That last one is
what a fence glob or a pathspec under the state root is built from, so a
`writablePaths` entry never has to spell `.flume/`. The resolver
refuses a default export that is not a
function, and refuses a factory that returns no `chain` with a `phases[]`
array. Take engine values from the parameter; your only engine `import` is
`import type`, which is erased at runtime.

That shape is what makes a second engine copy unreachable rather than
merely unlikely. A chain that imported engine *values* would resolve them
by walk-up from its own directory — so whenever the running engine was not
the copy that walk-up found, the process would hold two: one driving the
dispatcher, one building your phases, with `instanceof` and module state
split across them at equal versions and nothing reporting it. A factory has
nothing to resolve.

An `agent` or `forkResolver` override rides the factory's return
(`{ chain, agent, forkResolver }`), not a named module export — a named
export cannot receive the API. Prompts referenced by `Phase.promptPath`
resolve relative to `.flume/`.

```
.flume/
  chain.ts
  prompts/
    plan.md
    build.md
  plan/
    pending.json
    state.md
    open-questions.md
```

**Harness-managed state:** the runtime spells the names of its own state
dirs and files itself, so you neither author nor move them — the set is
`spec/jobs.md`, "Runtime ignores", which owns it and grows without asking
your chain. Two neighbours that set doesn't carry: `plan/pending.json` is
the default the runtime places, and `Chain.pendingPath` moves it;
`sessions/` is a chain's own artifact (`withSessionCapture`), placed by the
chain that captures it — the runtime never puts a directory there. Per-run
artifacts your chain writes are yours to place: root them at
`api.paths.flumeDir` and the one-`rm` teardown covers them too.

**One chain governs a checkout.** The two roots move independently:
`FLUME_DIR` relocates the mutable state root, `FLUME_CONFIG_DIR` relocates
the chain and prompts dir, and relocating state never changes which chain
loads. `promptPath` always joins `configDir`, which is always the directory
the chain actually lives in. See the README's "Chain residency" section for
the full contract.

## 1. Declaring a Phase

A `Phase` is plain data the dispatcher interprets. No per-phase imperative
code path; the harness owns the tick lifecycle and reads the fields you
set. The full interface lives in `src/Phase.ts`; every field it declares is
below, in declaration order. A field whose role opens with *Optional* may be
omitted; the rest are required.

| Field           | Role                                                                                                                              |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `name`          | Stable id. Matches the awake-flag file `.flume/awake/<name>`.                                                                     |
| `description`   | One-line description shown in `flume status`.                                                                                     |
| `promptPath`    | Prompt file path, relative to `.flume/`.                                                                                          |
| `concurrency`   | `"singleton"` or `"fanout"` — see §3.                                                                                             |
| `agent`         | Optional per-phase `Agent` override; resolution `phase.agent ?? chainModule.agent ?? dispatcher default`. See §4.                  |
| `writablePaths` | Globs the agent's commit must stay inside. Outside-of-glob writes revert the commit.                                              |
| `entryChannelPaths` | Optional globs always writable on an entry-scoped fanout tick, whatever the assigned entry declared — the cross-tick channel (a build phase reporting into `.flume/plan/open-questions.md`). Only consulted when `scopeWritesToEntry` is `true`, and declaring it without that flag is refused at chain load. Default `[]`. |
| `scopeWritesToEntry` | Optional opt-in narrowing a fanout tick's write allowance to `entry.files ∪ entryChannelPaths`, with `writablePaths` as the outer ceiling both checks clear. Default `false` — the fence is `writablePaths` alone, byte-identical to a singleton tick's. See the `<harness>` block in §5. |
| `gates`         | Validation steps the harness runs post-commit. See §2.                                                                            |
| `promptArgs`    | Optional builder for the `{{KEY}}` substitution map. Receives the per-tick `TickContext`.                                          |
| `handoff`       | Returns sibling phases to wake based on the tick's `TickResult`.                                                                  |
| `shouldRun`     | Optional predicate consulted before the agent is invoked. Returning `false` declines the tick — see below.                       |
| `shipped`       | Optional predicate deciding whether a fanout entry whose commit landed and passed every gate leaves the queue. Reads the facts on `ShipContext`; returning `false` keeps the commit on trunk and the entry in `pending.json`. Undeclared means shipped. |
| `setupWorktree` | Optional hook to provision a fresh worktree's gitignored deps the gates need — runs `pnpm install`, copies `.env`. May return `{ extraEnv }`. Fires under either concurrency. See §3. |
| `teardownWorktree` | Optional hook, `setupWorktree`'s cleanup mirror — best-effort, runs before the worktree is removed. Fires under either concurrency. See §3. |

The `slicePhase` declaration from `examples/cascade-chain.ts` — that chain's
plan is a ladder of singleton slices sharing one prompt, and this is the one
`Phase` all of them are built from, parameterized by the slice it serves:

```ts
const slicePhase = (slice: PlanSlice): Phase => ({
  name: slice.name,
  description: slice.description,
  promptPath: "prompts/plan.md",
  concurrency: "singleton",
  writablePaths: [
    // `stateRoot` is `api.paths.stateRootRel`, read once at chain load —
    // so a run under a relocated `FLUME_DIR` fences the
    // directory that run actually writes.
    `${stateRoot}/plan/pending.json`,
    `${stateRoot}/plan/state.md`,
    `${stateRoot}/plan/open-questions.md`,
    // The inbox is drained by deletion, so the fence has to reach it.
    `${stateRoot}/inbox/**`,
  ],
  gates: [pendingGate({ targetFence: build, extension: entryExtension })],
  shouldRun(ctx) {
    // Build hands the baton back on every tick, so most plan wakes land on
    // a queue plan already agrees with — a full invocation that re-derives,
    // concludes nothing changed, and commits nothing. Two facts the
    // dispatcher already computed say otherwise, and both arrive on the
    // TickContext: a standing prior-attempt record (build bailed, or its
    // commit was declined) that only a re-derive reconciles, and a queue
    // with nothing build can pick. Read from the context, never from
    // process.env or a readdir of the engine's prior-attempts directory.
    // The standing record is a reason to be woken, never a reason for a
    // slice to re-wake itself, so it is read here and not in `handoff`.
    const hasStandingAttempt = (ctx.priorAttempts?.size ?? 0) > 0;
    const pickable = (ctx.pickable ?? []).length > 0;
    return (
      (slice.name === DERIVE && hasStandingAttempt) ||
      slice.live({ flumeDir: ctx.flumeDir, pickable })
    );
  },
  promptArgs() {
    return {
      PENDING_SCHEMA: renderSchemaForPrompt(entryExtension),
      SLICE_JOB: slice.job,
    };
  },
  handoff(result) {
    return nextPhase(
      result.flumeDir,
      result.pickableAfter.length > 0,
      result.committed ? undefined : slice.name,
    );
  },
});
```

Things to notice:

- **`writablePaths` is a hard boundary.** The harness diffs each commit and
  reverts on out-of-glob paths. This replaces "You may NOT modify X" rules
  in prompts.
- **`handoff` reads the `TickResult`.** Fields: `committed`, `commitSha`,
  `gateResults` (the same `ReportedGateResult` rows the verdict persists —
  `details`, `verdict` and `skipped` included, so a handoff keys on the field
  rather than re-reading `message`), `pendingAfter`, `shippedTags`,
  `revertedTags` (entries a
  fanout wave reverted at merge — lets a handoff distinguish merge-thrash
  from a clean wave). Return `[]` to leave nobody awake — the system
  hibernates when no flag files are present.
- **A `Phase` is data, so a ladder of them is a `map`.** Cascade's plan is two
  slices — `plan-inbox` then `plan-derive` — built from the one declaration
  above and listed in `phases` in dependency order. Each `handoff` returns the
  first slice whose window is non-empty rather than a fixed sibling name, so
  the baton walks the ladder and falls through to `build` when no plan job is
  live.
- **`promptArgs` returns strings only.** Pre-stringify JSON yourself.

A fanout phase's `promptArgs` reads the `assignedEntry` for the tick:

```ts
promptArgs(ctx) {
  if (!ctx.assignedEntry) throw new Error("build requires assignedEntry");
  return {
    ENTRY_JSON: JSON.stringify(ctx.assignedEntry, null, 2),
    TAG: ctx.assignedEntry.tag,
    PER_PATH: ctx.assignedEntry.per.path,
    PER_SECTION: ctx.assignedEntry.per.section,
  };
}
```

Both `promptArgs` and the `shouldRun` predicate below receive the same
per-tick `TickContext`. It too lives in `src/Phase.ts`; every field it
declares is below, in declaration order.

| Field           | What it carries                                                                                                                   |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `cwd`           | The path this tick works in — its worktree, with one exception: a singleton `shouldRun` is consulted before provisioning, so its `cwd` is the repo root. A predicate that must resolve paths on both consults uses `flumeDir` instead. |
| `flumeDir`      | The absolute, resolved flume state root — the same path on both consults, and auto-injected as the reserved `{{FLUME_DIR}}` prompt arg, so most prompts need no `promptArgs` boilerplate to reach it. |
| `assignedEntry` | The pending entry this tick was handed. Fanout phases only.                                                                       |
| `pending`       | The full pending list, for a singleton phase reasoning about queue state.                                                         |
| `pickable`      | The entries the dispatcher would select right now — `blockedBy` resolved, declared forks checked through the chain's `forkResolver`, capabilities checked, this run's quarantine drop applied. A fact the dispatcher already computed, carried so a hook reads it instead of rebuilding it. Optional in the type only so a hand-built fixture may omit it; a dispatcher-built context always sets it. |
| `priorAttempts` | Every persisted prior-attempt record under `<flumeDir>/prior-attempts/`, keyed by keyspace and identity — `entry:<tag slug>` for a fanout record, `phase:<phase name>` for a singleton one, the name spelled exactly as your chain spells it (the file on disk sits at a slugged stem under its keyspace's directory; the map key does not). Optional in the type for the same fixture reason as `pickable`. |

### `shouldRun`: decline a tick before the invocation

The motivating case: a plan phase whose `handoff` already knows how to read
`pendingAfter.some((e) => e.gate.kind === "open")` to decide whether to wake
`build`. Without `shouldRun`, that same "is there pickable work" question
can only be answered *after* spending a full agent invocation — the agent
re-derives the plan, concludes nothing changed, and commits nothing. On one
measured 50-tick run, 14 plan ticks (28%) did exactly that. `shouldRun` lets
the chain answer the question before the invocation, from the same
`TickContext` `promptArgs` sees — every field but `cwd`, below.

`examples/cascade-chain.ts` ships that predicate on every plan slice, and §1
above quotes the declaration whole. It reads two facts the dispatcher already
computed: `ctx.pickable` — the entries build would select right now, so a
non-empty list means the queue needs no re-derive — and `ctx.priorAttempts`,
the standing records only a re-derive reconciles. Neither is re-derived by
the chain: a predicate reaching for `process.env` or a `readdir` of the
engine's `prior-attempts/` directory is naming a `TickContext` field that
should exist instead.

- **Undeclared is unchanged behavior.** A phase without `shouldRun` always
  runs; a phase whose `shouldRun` returns `true` is byte-identical to one
  declaring none.
- **Returning `false` ends the tick as a declined no-op.** No agent
  invocation, no commit — but `handoff` still runs on the unchanged prior
  result, and the baton sleeps/wakes exactly as it would on any other
  no-commit tick, so the chain can still pass the baton on.
- **What a decline saves depends on the concurrency — and so does `ctx.cwd`.**
  A **singleton** phase is consulted once per tick, ahead of all provisioning
  (the worktree prune, `createWorktree`, `setupWorktree`), so `ctx.cwd` is the
  repo root — no worktree exists yet, and declining costs a `rev-parse` and
  the pending read, nothing more. A **fanout** phase is consulted once per
  assigned entry, *inside* that entry's worktree, after the whole wave has
  been provisioned and every `setupWorktree` has finished its dependency
  install; `ctx.cwd` is that worktree, and declining saves the agent
  invocation alone — the worktree is built, skipped, and torn down with the
  wave. So a predicate resolving paths off `ctx.cwd` must not assume a
  worktree on a singleton phase; `ctx.flumeDir` is absolute and the same
  either way.
- **Synchronous, and cheap by contract.** A predicate needing I/O is doing too
  much; that work belongs in the tick it is trying to avoid, not in the gate
  that decides whether to run it.
- **A declined tick is a distinguishable fact**, not a silent no-op — it
  reports its own outcome, separate from a `clean-exit` (the agent ran and
  committed nothing) and from hibernation (nothing was awake).

## 2. Writing a custom Gate

A `Gate` is a validation step the harness runs after the agent's commit
lands. The shape:

```ts
interface Gate {
  name: string;
  when: "afterCommit" | "afterMerge";
  run(ctx: GateContext): Promise<GateResult>;
  command?: string; // the one command line this gate runs, when it has one
}

interface GateResult {
  ok: boolean;
  message: string; // one-line verdict for dispatcher + agent
  details?: string; // captured output, fed into next tick's prompt as context
  verdict?: string; // your own discriminant for *why* this gate ruled as it did
  skipped?: string; // the judge never ran, and why — `ok` is still the verdict
  failingFiles?: string[]; // paths the runner blamed, when it can name them
}
```

`afterCommit` runs on the worktree branch; failure drops the commit and the
entry stays pending. `afterMerge` runs on the trunk after the tick's span
has been cherry-picked onto it; failure reverts **only the offending
commit** — under fanout, the wave's clean siblings stay shipped and that one
entry returns to pending.

Both placements are open to both concurrencies. A singleton tick works in
its own worktree and cherry-picks its span onto the trunk like a wave of
one (§3, *Singleton*), so its `afterMerge` gate runs on the trunk with the
span merged — the same tree a fanout entry's sees, minus the siblings.

`verdict`, `skipped` and `failingFiles` are **facts about the run, not
engine judgments**: the dispatcher copies them onto the tick verdict and
interprets them no further.

- Set `verdict` when the *reason* your gate ruled as it did is something a
  later tick keys on — `"stale-input"` vs `"assertion-failed"`,
  `"cite-unresolved"` vs `"cite-missing"`. It rides the tick verdict's gate
  row and, on a failure that reverts the commit, the `gate-revert`
  prior-attempt record beside `message`. That's the whole trip: the engine
  never reads it, and nothing downstream copies it further. Without it a
  `shouldRun` ends up re-parsing the prose its own gate wrote.
- Set `skipped` whenever the gate returns `ok: true` **without running its
  judge** — no touched path its runner covers, a runner the chain scopes out
  by design. A bare `ok: true` claims the check was earned; spelling the skip
  is how a green verdict stays non-vacuous.
- Set `failingFiles` (repo-relative, forward-slash) when the runner names the
  files it blamed — a test reporter's JSON, a type-checker's diagnostics. The
  dispatcher compares that list against the reverted span's own touched paths
  to mark a suspect flake on the prior-attempt record, so a gate never has to
  call "flake" itself. Omit it and you get today's behavior: no marker, no
  inference.
- `command` is the gate's **own command line**, and the harness block shows
  it to the agent beside the gate's name — so a chain asking the agent to
  self-check before committing doesn't restate the command in its prompt from
  a parallel constant. `shellGate` sets it from its `cmd`/`args`, and the
  built-ins composed from it inherit it; a hand-rolled gate with no single
  command line declares none and renders as name alone.

### What's on `ctx`

`GateContext` is the gate's whole input surface. The dispatcher builds one
per invocation; treat it as read-only and confine side effects to disk
inside `cwd`. Nothing on it is optional for a gate's convenience: a field
that can be empty is empty for a reason the gate branches on — a relocated
state root, a stage with no trunk, a singleton tick with no entry — and each
says so below.

**Where the gate is running.**

- `cwd` — the working tree the gate runs in: the tick's ephemeral worktree
  under `afterCommit` (both concurrencies alike — a singleton tick works in
  its own worktree too), the primary checkout under `afterMerge`.
- `repoRoot` — the same value as `cwd`, spelled for the composition that
  wants a root rather than a working directory. No field reaches the primary
  checkout from inside a worktree, so a gate that needs the trunk belongs at
  `afterMerge`.
- `flumeDir` — the absolute, resolved state root: how a gate reaches
  state-relative paths (`join(ctx.flumeDir, "prior-attempts")`) without
  hardcoding `.flume/` or reading `process.env`. It is the **primary
  checkout's** state root at both stages, never rebased onto a worktree,
  because runtime state (`awake/`, `prior-attempts/`, `tick-verdicts.jsonl`)
  exists only there. Under `afterCommit` it is therefore *not* nested under
  `repoRoot` — the worktree lives inside it — so never derive a
  repo-relative path from the two.
- `stateRootRel` — the state root's path relative to the primary repo root,
  in git's own alphabet (forward slashes, whatever the host's separator).
  The one value that reads a **tracked** state-root file as the gated commit
  holds it: `git show <commitSha>:<stateRootRel>/plan/pending.json`. A gate
  that reads such a file off `flumeDir` instead reads the *previous*
  commit's copy under `afterCommit`. The key is always present; its value is
  `undefined` when the state root is relocated outside the repository, and
  that absence is the fact a gate branches on.
- `configDir` — the absolute chain/prompts dir, rebased onto the gate's own
  `cwd` while it resolves inside the repo (a worktree carries the tracked
  layout at the same offset), passed through verbatim when it is relocated
  outside one.
- `pendingPath` — the absolute, resolved queue path (`Chain.pendingPath`).
  Read it directly: re-composing it from `ctx.flumeDir` and literal segments
  hardcodes a layout the chain can move.

**What is being gated.**

- `phaseName` — the phase the gate is running for.
- `commitSha` — the commit under inspection: the tip of the gated span, at
  both stages.
- `touchedPaths` — the span's changed paths (repo-relative, forward-slash),
  the cumulative `baseSha..commitSha` diff computed once per commit and
  shared across every gate the tick runs. Read this rather than shelling out
  `git show --name-only` yourself.
- `baseSha` — the sha the span started from: the worktree's tip when the
  tick branched, the same value the dispatcher cherry-picks from. Set at
  **both** stages. It is how a gate tells an input the tick *ignored* from
  one it *never saw* — `git log <baseSha>..HEAD -- <inputs>` names what
  landed on trunk after the tick branched, and `git show <baseSha>:<path>`
  is the input as the tick read it. Without it a chain rebuilds the base
  from a worktree path convention the engine never promised. A gate that
  needs the *tree* at that sha rather than a file out of it asks the API for
  a detached checkout (`api.git.checkoutAt`), which the engine plants under
  the worktrees base and removes when the gate returns — a differential gate
  never provisions its own.
- `landedOnSha` — under `afterMerge`, the trunk tip the gated span landed
  onto: the lower end of the range `touchedPaths` is diffed over, and the
  trunk as this entry found it before its own commits were carried across.
  It is the right *before* for a per-entry cumulative gate on trunk — one
  measuring a set before and after this entry and refusing growth. `baseSha`
  is what the tick *saw* when it branched and every sibling in a fanout wave
  shares it, so a gate measured against that inherits every sibling's
  landing; `HEAD^` is right only while a span lands as one commit. Absent
  under `afterCommit`, where no trunk is involved and `baseSha` is the whole
  story.
- `entry` — the pending entry the gated span was provisioned for, as the
  wave selected it: set at both stages under fanout, absent on a singleton
  tick, which carries no entry. It is how a chain gate holds a commit to the
  entry's *own* contract — the behaviors its `tests[]` names, an acceptance
  its extension declares — rather than to the phase's uniform bar alone. The
  engine reads none of those fields; a gate reads them back through the
  chain's own extension schema.
- `log` — the harness-side output channel. A gate does not write to stdout
  itself.

### Use the built-ins first

```ts
const factory: ChainFactory = (flume) => {
  const { shellGate, tscGate, vitestGate, eslintGate, pendingGate } = flume;

  // ...
};
```

- `tscGate` — `pnpm tsc --noEmit`.
- `vitestGate` — `pnpm test --run`.
- `eslintGate` — `pnpm lint`. Opt-in.
- Each of those three doubles as its own factory:
  `tscGate({ cmd?, args?, when? })` returns the same check run through a
  different package-manager binary (`{ cmd: "npm", args: ["exec", "--",
  "tsc", "--noEmit"] }`) or placed at the other gate point
  (`{ when: "afterMerge" }`, see *Where to place a gate* below). Used bare
  (`gates: [tscGate]`) each *is* the pnpm-flavored `afterCommit` gate.
- `writablePathsGate` — attached automatically by the dispatcher from each
  phase's `writablePaths`. Don't list manually.
- `pendingGate({ targetFence, extension?, fenceWhen?, hint? })` —
  composed `pending.json` validation plus a plan-time fence pre-check
  against the target phase. See below.
- `shellGate({ name, when, cmd, args, failHint? })` — escape hatch for "run
  a command, fail on non-zero". The four built-ins above are all
  `shellGate` instances.

### `pendingGate`: composed validation + fence pre-check

`pendingGate` replaces a hand-rolled "does `pending.json` parse" gate
(below) with one that also catches a class of guaranteed-revert bug
before it reaches build: it validates the queue against the composed
core+extension schema (§2), then pre-checks every entry's declared
`files` against `targetFence.writablePaths ∪ targetFence.entryChannelPaths`.
An entry whose declaration can't survive that fence fails **here, at plan
time, naming the offending paths** — instead of shipping through plan and
burning a whole build tick on a commit that was always going to revert.

```ts
const build: Phase = {
  name: "build",
  writablePaths: ["src/**", "tests/**"],
  // ...
};

const plan: Phase = {
  name: "plan",
  gates: [pendingGate({ targetFence: build })],
  // ...
};
```

Pass the target `Phase` itself as `targetFence` — not a spread of its
`writablePaths`/`entryChannelPaths` into a fresh array. `pendingGate` reads
those two fields **inside `run()`, on every invocation**, not once at
construction, so it always fence-checks against the target's current
value.

That matters for a declaration-driven chain, where a phase's fence isn't a
static array literal but resolved lazily — e.g. from a per-job
`declaration.json` the chain doesn't read until the phase is actually
used. Combine a getter-backed fence with a `get gates()` accessor on the
phase that calls `pendingGate(...)` so construction itself is deferred:

```ts
const build: Phase = {
  name: "build",
  get writablePaths() {
    return readJobDeclaration().writablePaths; // resolved per job, not at chain load
  },
  // ...
};

const plan: Phase = {
  name: "plan",
  // Deferred: the dispatcher doesn't read `plan.gates` until the tick
  // needs it, well after the whole chain module — including `build` — has
  // finished evaluating. A plain `gates: [pendingGate({ targetFence: build })]`
  // array literal here would call `pendingGate(...)` at module-load time,
  // before `build`'s declaration-driven writablePaths has anything to read.
  get gates() {
    return [pendingGate({ targetFence: build })];
  },
  // ...
};
```

`fenceWhen` narrows which entries the pre-check applies to (default:
every entry) — supply it to exempt park-exempt `gate.kind` values (e.g.
`"parked"`, `"deferred"`) the same way the build fence itself does.

`hint` appends chain-authored operator guidance verbatim to both violation
messages (schema and fence) — the same capability/convention split as
`failHint` on `shellGate`: you supply the text, the engine supplies the
enforcement. Omitted, the messages read exactly as they did before the option
existed.

The queue this gate validates is `ctx.pendingPath`, the resolved
`Chain.pendingPath` — there is no `pendingPath` option, because the path is
already a fact the dispatcher hands every gate.

### When to write a bespoke Gate

Reach for one when the check needs structured logic (read a file, parse
JSON, summarize N issues) rather than just an exit code. The example
below predates the `pendingGate` builtin above (`spec/pending.md`,
"`pendingGate` — validation and fence pre-check as an opt-in builtin") —
reach for that first; it composes this exact parse check with a fence
pre-check the hand-rolled version doesn't have. Write a bespoke gate when the built-ins
genuinely don't fit:

```ts
const pendingParseGate: Gate = {
  name: "pending.json parses",
  when: "afterCommit",
  async run(ctx) {
    const raw = await readFile(ctx.pendingPath, "utf8");
    const r = parsePending(raw);
    if (r.ok)
      return { ok: true, message: `parsed (${r.entries.length} entries)` };
    return {
      ok: false,
      message: `pending.json has ${r.errors.length} schema violations`,
      details: r.errors
        .map((e) => `  [${e.index}] ${e.path}: ${e.message}`)
        .join("\n"),
    };
  },
};
```

The shape to internalize:

- **Idempotent and side-effect-free.** No commits, no pushes. Read state,
  report a verdict.
- **`details` is feedback for the agent.** On failure, `message + details`
  are routed into the next tick's prompt as context. Write `details` for
  the agent to read on retry — concrete file paths and line numbers beat
  narration.
- **Respect `ctx.cwd`.** `afterCommit` gates run inside the tick's worktree
  — per-entry under fanout, the phase's own under singleton — not the
  operator's checkout. `ctx.commitSha` is set if you need to
  inspect the commit (`git show`, `git diff`).
- **Read the roots off `ctx`; never re-compose one.** `ctx.pendingPath` is
  the resolved queue, `ctx.flumeDir` the state root, `ctx.configDir` the
  chain/prompts dir — each resolved once per tick by the dispatcher. A gate
  that rebuilds one of them out of literal segments is keeping a second copy
  of a fact the engine already holds, and it goes wrong the moment the chain
  relocates the real one.

### Where to place a gate: cheap structural at `afterCommit`, expensive at `afterMerge`

The default: **cheap, deterministic structural gates run at `afterCommit`;
expensive correctness gates run at `afterMerge`.** `tscGate` and a
bundle-self-containment check are structural — fast, deterministic, worth
stopping before a commit ever reaches the trunk. A full test suite is
expensive correctness — and under fanout that cost multiplies.

The split is about contention, not preference. A fanout wave runs N
worktrees in parallel and each runs its `afterCommit` gates at the same
time, so an expensive gate is launched N-wide simultaneously: N full test
suites contending for the same cores. Under that load a suite that passes
comfortably in isolation can blow its own timeout — and a timeout is a
gate failure, so the harness reverts a commit that was never broken.
(Observed: a fanout wave where assertions blew vitest's 5 s timeout purely
under CPU contention, reverting three clean commits.)

`afterMerge` gates do not contend. They run on the trunk one entry at a
time, after the wave has merged — the expensive suite is paid once per
entry serially instead of N-at-once, so it gets the resources it needs and
a timeout means a real hang, not contention noise. And because an
`afterMerge` failure reverts only the offending entry (not the wave), the
cost of moving a flaky-under-load gate there is bounded to the one entry
that actually fails.

The tradeoff to weigh: an `afterMerge` gate runs _after_ the commit
reaches the trunk, so a genuinely bad commit is briefly on the trunk
before it is reverted, whereas an `afterCommit` gate catches it pre-merge.
Keep structural gates at `afterCommit` for exactly that reason — they are
cheap enough to run N-wide and you want type errors stopped before merge.
Split by cost: fast deterministic checks gate the merge; heavy or
timing-sensitive correctness gates gate the trunk.

This is a default, not a law. A suite whose N parallel copies still finish
well inside their timeout can stay at `afterCommit`, where it buys the
pre-merge catch as well. Move it to `afterMerge` once running it N-wide is
itself what makes it flake.

A singleton phase has both placements too, and weighs them on the other
axis: nothing contends with a lone tick, so the question is where the check
wants to stand rather than what it costs. `afterCommit` runs it in the
tick's own worktree — a cold tree the phase's `setupWorktree` just
provisioned — and a failure keeps the commit off the trunk entirely.
`afterMerge` runs it on the trunk with the span applied, which is the only
place a check about the *merged* result can run: a cross-cutting suite that
must see the tick's output alongside whatever else landed on the trunk
while it worked. The cost is the usual one — a bad commit is briefly on the
trunk before the revert.

Moving a builtin costs nothing: `tscGate({ when: "afterMerge" })` is the
same check at the other point. Don't hand-roll a `shellGate` restating the
builtin's own `cmd`/`args` to relocate it — a chain-side copy of a command
the engine already owns goes stale the moment the builtin's does.

### Don't gate the in-worktree build on host-level integration tests

`vitestGate` runs `pnpm test` (= `vitest run`) **inside the tick's own
worktree** — a freshly `pnpm install`'d tree. An `afterCommit` gate's `cwd` is
that ephemeral worktree under both concurrencies (`spec/chain.md`, "What a
gate receives"), so a singleton phase's gate lands in a cold tree exactly as a
fanout entry's does; a wave adds full-suite parallel load on top. Either way
it is the wrong place for tests that spawn real subprocesses (`flume
tick`/`loop` via `tsx`, real `git`) or otherwise need a warm host: their cold
start-up costs are paid on every tick, multiply under N-wide contention, and
can blow the suite's timeout, reverting a commit that was never broken. The
failure is an execution-environment artifact, not a defect in the code under
test.

Split the suite into two lanes instead of raising the timeout (a bigger timeout
masks nothing and leaves the worktree-hostility in place):

- **Fast lane** — unit + fast tests; the default `vitest run`. This is exactly
  what the build's `afterMerge` gate invokes, so it stays fast and worktree-safe.
- **Integration lane** — anything needing real subprocesses or a warm host.
  Mark it with the `*.integration.test.ts` filename convention and **exclude it
  from the default run** in `vitest.config.ts`, so the in-worktree gate never
  runs it. It runs at the **host** (main checkout, warm deps, no worktree) via a
  dedicated `pnpm test:integration` — pre-merge / CI, not the autonomous gate.

```ts
// vitest.config.ts — exclude the integration lane from the default (gate) run
import { configDefaults, defineConfig } from "vitest/config";
export default defineConfig(({ mode }) => {
  const integration = mode === "integration";
  return {
    test: {
      include: integration
        ? ["tests/**/*.integration.test.ts"]
        : ["tests/**/*.test.ts"],
      exclude: integration
        ? [...configDefaults.exclude]
        : [...configDefaults.exclude, "**/*.integration.test.ts"],
    },
  };
});
```

Select the lane with `--mode integration` (`pnpm test:integration`) rather than
an env-var prefix — `VITEST_LANE=integration vitest run` is POSIX-only shell
syntax and fails under `cmd.exe`/PowerShell.

Integration coverage is **preserved, relocated** — not dropped. The
process-boundary guarantees still run, at the host where they are fast and
reliable. (A vitest workspace/projects split is an equivalent mechanism; the
boundary is what matters, not the vitest knob.)

### Anti-pattern: gate on the safety property, not on byte-equality of a generated artifact

A gate must assert the property you actually care about — not byte-identity
of a derived artifact against a checked-in copy.

Worked example: `bundleFreshnessGate`. The intent was reasonable — "the
committed bundle is in sync with source." The implementation was not: it
rebuilt the bundle and asserted byte-equality against the checked-in
`dist/`. It reverted a string of clean commits. The cause: pnpm's
virtual-store hashes leaked into esbuild's output, producing ~257
pure-reorder / hash-churn lines that changed the bytes without changing a
single runtime behavior. The property that actually mattered — _the bundle
is self-contained; no import escapes it_ — lived in a different gate,
`bundleSelfContainmentGate`, which inspected that invariant directly and
did not churn.

The lesson generalizes. Generated artifacts carry non-semantic entropy:
content hashes, declaration order, timestamps, embedded toolchain-version
strings. Byte-equality conflates _changed_ with _broke_, so the gate fails
on entropy and reverts work that was correct.

How to apply: before writing a gate over a generated file, ask "what would
a _bad_ version of this file actually do wrong?" and assert exactly that —
does it resolve, does it parse, does it satisfy its contract tests, does
any import escape it. If you cannot name the failure a byte-diff would
catch, the gate is testing your toolchain's determinism, not your code —
don't write it.

## 3. Choosing concurrency

The choice is structural — it follows from what the phase outputs.

### Singleton

Pick `"singleton"` when the phase derives a shared artifact that can't
admit concurrent edits — plan derives the whole `pending.json` from disk.
Two parallel ticks would step on each other.

A singleton tick runs in its own worktree too — branch
`flume/[<ns>/]<phase>`, a wave of one — and its span is cherry-picked back
onto the trunk. `afterCommit` gates run in that worktree; `afterMerge`
gates run on the trunk after the cherry-pick. The operator's checkout is
never the tick's working tree.

`backlog-groomer-chain.ts`'s single `groom` phase is singleton for the same
reason plan is: it derives `BACKLOG.json` from disk each tick. It just
never grows a fanout sibling — nothing here requires one, so nothing forces
a plan/build split. Not every chain needs both concurrency models.

### Fanout

Pick `"fanout"` when each tick owns one independent unit of work over a
known file set. Build is canonical: each pending entry declares the files
it writes, and entries with disjoint sets run in parallel.

The dispatcher uses `partitionByFileOverlap` to group pickable entries
into maximal disjoint batches, picks the first, and spawns one worktree
per entry under `<flumeDir>/worktrees/<entry-slug>/` (base overridable via
`FLUME_WORKTREES_DIR` — see below). Agent + `afterCommit` gates run in
parallel; the wave then merges to trunk and runs `afterMerge`.

```ts
partitionByFileOverlap(entries, { maxParallel: 4 });
// => [[entryA, entryC], [entryB]]   // A and C disjoint; B overlaps both
```

The partition reads `entry.files.new[].path`/`.edit[].path`/`.retire[]`
(see `touchedPaths()` in `PendingSchema.ts`); declare files truthfully
when hand-authoring entries. When a merge-time failure reverts an entry,
the dispatcher persists the attempt's *actual* commit footprint onto it as
`PendingEntry.observedFiles`, and the partition reads that alongside the
declared `files` — so the retry is separated from whatever it collided
with even where the declaration under-stated the reach.

Failure modes handled: an `afterCommit` fail drops that worktree's commit
(siblings continue); a merge cherry-pick conflict leaves that entry in
pending (others merge); an `afterMerge` fail reverts only the offending
entry's commit — the clean siblings stay shipped and that entry returns to
pending. On the success side, ship bookkeeping auto-opens `blockedBy`
gates whose blocker shipped in the same wave, so a chained entry becomes
pickable without waiting for an interim plan tick.

### `setupWorktree`: provisioning a fresh worktree

Both concurrencies provision, so both invoke the hook: a fanout wave calls
it once per entry, a singleton tick once for the one worktree it runs in
(`ctx.worktreeKey` is the entry's tag under fanout, the phase name under
singleton).

A fresh worktree holds only tracked files; provision the gitignored deps
the gates need first. **Default:** the `setupWorktree` helper — sibling to
the `builtinGates` precedent (`shellGate`, `tscGate`, …), carried on the
factory's `api` parameter — inspects the worktree for a lockfile and runs
the install it implies: `pnpm-lock.yaml` → `pnpm install --frozen-lockfile`
(pnpm hardlinks from its global store, so it costs seconds, not a
re-download); `package-lock.json` → `npm ci`; neither → rejects instead of
guessing a package manager.

```ts
const factory: ChainFactory = (flume) => {
  const { setupWorktree } = flume;

  const chain: Chain = {
    // ...
    build: {
      // ...
      async setupWorktree({ worktreePath }) {
        await setupWorktree(worktreePath);
      },
    },
  };

  return { chain };
};
```

Copy plain files (`.env`) directly, alongside the helper call.

**Never symlink `node_modules` in** — pnpm deletes a symlinked
`node_modules` on install
([pnpm/pnpm#9973](https://github.com/pnpm/pnpm/issues/9973)), silently
breaking the worktree the first time a tick installs.

**Experimental opt-in:** `enableGlobalVirtualStore` in `pnpm-workspace.yaml`
([pnpm git-worktrees](https://pnpm.io/git-worktrees)) shares one virtual
store across worktrees, skipping the install — an opt-in only, never a
default. Either way, add a strategy-agnostic `afterCommit` `shellGate`
that fails loud if a sentinel dependency stops resolving from the worktree
root (`node -e "require.resolve('vitest')"`).

A singleton tick pays this cost too — it provisions a worktree like any
other tick, so budget the install there as well (seconds, via pnpm's
hardlinked store). A phase too light to justify an install says so in its
own hook, by returning early.

**Concurrency recipe: repo-owned unit, thin caller, serialized queue.**
This one is fanout's alone — a singleton tick makes a single setup call,
with nothing to race against. The dispatcher runs a wave's `setupWorktree`
calls concurrently — one `Promise.all` across every entry in the batch — so
N entries provision in parallel rather than serially. That's safe for
disjoint per-worktree state,
but an install racing against a **shared cold cache** (the package
manager's global store, not yet warmed) is not disjoint: two
`pnpm install --frozen-lockfile` calls hitting an empty store at the same
moment can race underneath both. `Promise.all` also fails all-or-nothing —
one entry's setup rejecting poisons the wave's `await`, taking every
sibling's setup down with it instead of leaving the clean ones to proceed.

The recipe that avoids both:

- **The repo owns the provisioning unit.** The actual install logic —
  what the exported `setupWorktree` helper above wraps — lives as one
  function in the repo (under `.flume/` or the chain's own source), not
  duplicated inline per chain.
- **The chain's `setupWorktree` hook stays a thin caller.** It invokes
  that one repo-owned unit and returns its result, carrying no install
  logic of its own — the code sample above is already this shape.
- **Wave setups serialize through a non-poisoning queue.** Instead of
  awaiting every entry's setup in one `Promise.all`, the repo's
  provisioning unit enqueues each call onto a single in-process queue (a
  promise chain, a mutex, a one-token semaphore) so only one setup runs at
  a time, warming the shared cache without a concurrent second writer.
  "Non-poisoning" is the operative property: one entry's rejection
  resolves *that* entry's queued call with its own error and lets the
  queue keep draining the rest — it must never reject the queue itself,
  which would take every not-yet-run sibling down with it the same way
  `Promise.all` does today.
- **A failed setup fails loud, with its own error.** The queue surfaces
  the failing entry's actual error back to its own `setupWorktree` call —
  never a generic "queue aborted", never swallowed into a silent no-op —
  so the dispatcher's existing per-entry handling (that entry stays
  pending, siblings continue) has a real error to log and act on.

This is chain-authored discipline, not an engine capability — a scheduling
knob in the dispatcher itself isn't warranted by today's evidence (see
`engine-boundary.md`); the queue lives in the chain's own provisioning
unit, behind the thin `setupWorktree` caller above.

### `{ extraEnv }`: per-worktree env for the agent

`setupWorktree` may return a `WorktreeSetupResult` — `{ extraEnv }` — and
the dispatcher layers those vars on top of its own `process.env` for **that
worktree's agent invocation**. This is the seam for an ephemeral resource
handle the chain provisions at setup time: a per-worktree `DATABASE_URL`, a
scratch dir, a short-lived credential — anything the agent needs at runtime
that shouldn't be baked into the worktree's tracked filesystem.

```ts
async setupWorktree({ worktreePath, worktreeKey }) {
  await setupWorktree(worktreePath);
  const dbUrl = await provisionScratchDb(worktreeKey);
  return { extraEnv: { DATABASE_URL: dbUrl } };
},
```

Scope notes:

- **Agent only.** `extraEnv` reaches the agent invocation; gates spawn from
  the dispatcher's own env. A gate that needs the handle should read it from
  disk state the setup hook wrote, not expect the var.
- **Either concurrency.** A singleton tick invokes the hook for its own
  worktree and layers whatever it returns onto that tick's agent
  invocation, exactly as a fanout entry's does.
- **Void returns are fine.** An implementation that only provisions deps and
  returns nothing is unaffected.

### `teardownWorktree`: the cleanup mirror

`teardownWorktree(ctx)` runs after the agent exits and gates finish, just
before the harness removes the worktree. It receives the same
`WorktreeSetupContext` as setup (`worktreePath`, `repoRoot`, `worktreeKey`) —
use it to release whatever setup acquired: drop the scratch DB, return the
lease, delete the issued credential.

```ts
async teardownWorktree({ worktreeKey }) {
  await dropScratchDb(worktreeKey);
},
```

It is **best-effort**: a throw is logged and does not block worktree
removal. Don't put anything correctness-critical here — a crashed tick can
skip it, so acquired resources should also be reclaimable by an external
sweep (a TTL, a startup cleanup pass).

### Reaping what a killed tick never released

That sweep asks **git**, not the filesystem. `flume.git.readWorktreeRegistry`
hands back every worktree git currently registers for the repo, each path
mapped to the branch it is checked out on — the same probe the harness itself
judges an occupied worktree path on:

```ts
// setupWorktree filed each handle under the absolute `worktreePath` it was
// given; a reaper that outlives the process persists this map to disk.
const allocated = new Map<string, ScratchDb>();

async function reapOrphans(repoRoot: string): Promise<void> {
  const registry = await flume.git.readWorktreeRegistry(repoRoot);
  if (!registry.read) {
    // "Could not ask" is not "nothing is registered". Reap nothing.
    console.warn(`[chain] worktree registry unreadable: ${registry.reason}`);
    return;
  }
  for (const [worktreePath, db] of allocated) {
    if (registry.worktrees.has(resolve(worktreePath))) continue; // still live
    await dropScratchDb(db);
    allocated.delete(worktreePath);
  }
}
```

Two properties the return type carries, and the reason to take this over a
`readdir` of the worktree base:

- **Unreadable is not empty.** The result is
  `{ read: true, worktrees }` or `{ read: false, reason }`, never an empty map
  standing in for a failed `git` call — so a reaper cannot free a live arm's
  handle because git happened not to answer.
- **A directory listing answers a different question.** The base moves
  (`FLUME_WORKTREES_DIR`, below), a shared base also holds sibling checkouts'
  container directories, and residue whose registration git has already pruned
  still has a directory. None of those are distinguishable by name; all of them
  are by the registry.

`worktrees` is keyed by absolute, resolved spellings, and it is git's own
list — the **primary checkout is in it** too. Each value is the branch that
worktree is checked out on, short-form (`flume/<slug>`, the spelling `git
branch -D` takes), and `undefined` for a detached checkout. Which of those
worktrees are yours to reap is your chain's to decide; the engine reports the
fact and stops there.

The engine's own startup sweep reads that pairing rather than a branch glob:
it deletes exactly the branches the worktree directories it removed were
checked out on, so a `flume/**` branch a sibling checkout of the same
repository holds is left standing.

### Where worktrees live: `FLUME_WORKTREES_DIR`, `Chain.worktreesBase`

Every tick's worktree is created under `<flumeDir>/worktrees/<slug>/` — the
entry's slug under fanout, the phase's own under singleton
(`spec/worktrees.md`, "Singleton runs in a worktree"). Two things move that
base, in this order: the `FLUME_WORKTREES_DIR` env var when set (resolved
against the cwd when relative), else `Chain.worktreesBase` when your chain
declares one, else the default. The env var is the operator's — on a host
whose chain file they may not own — so it outranks the declaration.

```ts
export default (api: FlumeApi): ChainModule => ({
  chain: {
    phases: [...],
    humanOnly: [],
    // A function of the roots the runtime resolved, called once when the
    // chain loads. Must return an absolute path; a relative one is refused
    // at load, because a tick runs at the repo root and a gate runs inside
    // a worktree.
    worktreesBase: (paths) => join(dirname(paths.repoRoot), "flume-worktrees"),
  },
});
```

A function rather than a path, and evaluated rather than stored: `chain.ts`
is committed and placement is machine-local, so the chain declares *how* to
compute a base — off `paths.repoRoot`/`paths.flumeDir`, off whatever the
host tells it — instead of carrying someone else's directory layout in the
repo. It is also what lets a chain relocate its worktrees without the
module-scope `process.env.FLUME_WORKTREES_DIR = …` side effect that has to
run before flume's own module loads.

Creation, the per-wave stale-directory removal, the startup sweep and a
gate's `api.git.checkoutAt` all read the one resolution, so declaring a base
moves them together.

Reach for a relocated base when worktrees must sit **outside every repo-path
prefix**. The observed failure it exists for: an agent whose cwd contains
the root checkout's path as a prefix (the default
`<repoRoot>/.flume/worktrees/<entry>` does) derives the root from its own
cwd and operates there instead of in its worktree — writes the
writable-paths guard never sees, because they never land in the worktree
being diffed. An out-of-tree base (a sibling tmpdir) removes that vector.
Two chain-author consequences:

- `setupWorktree`/`teardownWorktree` receive absolute `worktreePath`s, so a
  hook that already uses `ctx.worktreePath` (rather than assuming
  `.flume/worktrees/…`) is unaffected by the override.
- Worktrees relocated outside `FLUME_DIR` leave the dock's one-`rm`
  footprint (see the README). They are ephemeral — created and removed per
  wave — but a crashed run can strand one at the override location.

## 4. The agent seam

`Agent` is the interface between the dispatcher and an LLM CLI. The package
ships one implementation, `claudeCode()`, plus two decorators.

```ts
const factory: ChainFactory = (flume) => {
  const { claudeCode, withSessionCapture, withTerminalRenderer } = flume;

  const agent = claudeCode({
    outputFormat: "stream-json",
    dangerouslySkipPermissions: true,
  });

  // ...
};
```

### `claudeCode(opts)`

Spawns `claude -p` with the rendered prompt on stdin. Options:

- `binary` — path to the `claude` binary. Default: resolves from PATH.
- `dangerouslySkipPermissions` — passes `--dangerously-skip-permissions`.
  Default `true`: every Flume tick runs in a worktree the harness controls.
- `outputFormat` — `"text"` (default) or `"stream-json"` (adds
  `--output-format stream-json --verbose`). Required for
  `withTerminalRenderer`.
- `inheritUserMcp` — load the user's own MCP configuration too. Default
  `false`: `--strict-mcp-config` rides the argv, so a tick loads only the MCP
  configuration the chain hands it. Set `true` to omit the flag and inherit.
- `model` — passes `--model <value>`. No default: undeclared, the flag is
  omitted and the binary's own default applies.
- `extraArgs` — appended after the format flags.

### Decorators

Decorators wrap an `Agent` and return another `Agent`, so they compose.
Innermost = raw provider; outermost = last transform.

- `withSessionCapture(agent, { dir, filename? })` — tees stdout chunks to a
  file as they arrive.
- `withTerminalRenderer(agent, { tag? })` — parses NDJSON stream events
  and emits a one-line-per-tool-call summary. The wrapped agent must emit
  NDJSON (`outputFormat: "stream-json"`). Default `tag` prefixes each line
  with the basename of the invocation's cwd — every tick's worktree directory
  name: the entry slug under fanout, so a wave's interleaved lines stay
  attributable, and the phase name under singleton.

The canonical composition (disk capture + terminal rendering):

```ts
const agent = withTerminalRenderer(
  withSessionCapture(claudeCode({ outputFormat: "stream-json" }), {
    dir: resolve(flume.paths.flumeDir, "sessions"),
  }),
);
```

Order matters: capture innermost so the file holds the full NDJSON;
render outermost so the terminal sees the human-readable summary.

### What a decorator can read off the invocation

A decorator is composed once, from a `Phase.agent` getter that holds no
`TickContext`, so the `AgentInvocation` it receives is the only thing it
knows about the run. Beyond `cwd` and `prompt`, that shape carries:

- `entryTag` — the tag of the provisioned entry this invocation is running.
  Set under `concurrency: "fanout"`, absent under `"singleton"`, which
  provisions no entry and so has no tag to state. It is the same fact the
  tick verdict's per-invocation `tag` row carries, handed to the decorator
  instead of left only on disk; read it rather than recovering the tag by
  pattern-matching the rendered `prompt`. Note that it is *not* the worktree
  key `setupWorktree` receives as `ctx.worktreeKey`, which falls back to the
  phase name under singleton.
- `extraEnv` — whatever this tick's `setupWorktree` returned.
- `timeoutMs` / `signal` — the per-invocation cap the provider must honor.

A decorator that needs a fact none of these carry is a missing engine
surface, not a chain problem — file it rather than re-deriving it.

### Per-phase agents

`Phase.agent` assigns an agent to one phase. Per-tick resolution is

```
phase.agent ?? chainModule.agent ?? DispatcherOptions.agent
```

— the phase's own value, else the chain's `agent` export, else the
dispatcher default. Phases without an `agent` field are unaffected.

The field takes an `Agent` value, not a model string, so it composes with
the decorators above — "same decorator stack, different model" is exactly
what a string cannot express. The canonical use is the architect/editor
split (plan on a stronger model, build on a cheaper one). A model-only
variation is `claudeCode({ model: "…" })` inside the phase's agent value —
the adapter owns the flag, so the chain names a model rather than assembling
argv. A chain-local helper amortizes re-stating the decorator stack:

```ts
const SESSIONS = resolve(flume.paths.flumeDir, "sessions");

function modelAgent(model: string): Agent {
  return withTerminalRenderer(
    withSessionCapture(claudeCode({ outputFormat: "stream-json", model }), {
      dir: SESSIONS,
    }),
  );
}

const plan: Phase = { /* … */ agent: modelAgent("claude-opus-4-8") };
const build: Phase = { /* … */ agent: modelAgent("claude-haiku-4-5") };
// Phases with no `agent` field keep the chain/dispatcher default.
```

### Per-run artifacts go under `FLUME_DIR`

Note the `dir` above: it is **`flume.paths.flumeDir`-relative**, not a fixed
`.flume/sessions` and not the chain's own directory. This is a requirement,
not a stylistic choice.

Flume's mutable state — baton, pending, worktrees, prior-attempts — relocates
under one root via the `FLUME_DIR` env var, so the whole footprint can live
outside the repo (a tmpdir) and be torn down in a single `rm` (the
attach-work-detach posture; see the README). That guarantee holds only if
**every** per-run artifact a chain writes also lives under that root. Session
logs are the canonical case: pin them at `configDir` (`CHAIN_DIR`) and a
relocated dock's `rm` leaves them stranded under the config dir whenever
`FLUME_DIR` and `FLUME_CONFIG_DIR` are relocated independently.

The runtime hands you that root rather than making you find it. `api.paths`
carries `{ repoRoot, configDir, flumeDir }` — absolute, already canonicalized,
the identity-same values the dispatcher was constructed with. `buildFlumeApi`
takes them as a **required** argument, so there is no way to be handed an API
whose roots are unresolved, and therefore nothing for a fallback leg to cover:
a `?? CHAIN_DIR` beside `flume.paths.flumeDir` would be re-deriving a fact the
engine has already resolved, and would answer with the config dir if it ever
fired. The runtime supplies the root; **placement is the chain's job.**

**The rule:** if your chain writes any per-run artifact (session captures,
scratch logs, anything mutable that a run produces), root its path at
`flume.paths.flumeDir` — not the chain dir, not `process.env`, not a
hardcoded `.flume/`.

**For a committed path under that root, use `api.paths.stateRootRel`.**
`flumeDir` is absolute; a fence glob, a `pendingGate` target, an
`entryChannelPaths` entry and a `git show <sha>:<path>` pathspec are all
repo-relative and forward-slashed, which is exactly what `stateRootRel`
reports — the same value `ctx.stateRootRel` carries at tick time, handed over
at chain load because that is when a fence is declared. Do not rebuild it:
`relative(repoRoot, flumeDir)` answers in the host's separator, so the glob
you compose from it matches nothing on win32. It is `undefined` when the
state root is relocated outside the repository; a chain whose artifacts are
committed refuses at load (`examples/cascade-chain.ts` is the worked case),
and a chain that commits nothing under the root ignores it.

#### Gates and prompts get `flumeDir` injected too

A chain never reaches into the global env for its roots. Which surface hands
them over depends on where you are, and there is one for every position:

- **The factory** receives `api.paths` at chain-load — the seam for anything
  decided before a tick exists: artifact placement (the sessions case above,
  off `flumeDir`) and `writablePaths` (off `stateRootRel`).
- **Gates** receive the resolved roots on `GateContext` — `ctx.flumeDir`
  (state root), `ctx.configDir` (chain/prompts dir), and `ctx.pendingPath`
  (the queue, already resolved from `Chain.pendingPath`); *What's on `ctx`*
  (§2) walks the rest of that surface. A gate that reads
  pending reads `ctx.pendingPath` directly; re-composing that path out of
  `ctx.flumeDir` and literal segments both hardcodes a layout the chain can
  move and re-derives a value the dispatcher resolved once per tick. The
  builtin `pendingGate` is the worked example.
- **Prompts** can use the reserved `{{FLUME_DIR}}` placeholder with **no
  `promptArgs` boilerplate** — the dispatcher auto-injects it into every
  prompt's substitution map. Write `{{FLUME_DIR}}/plan/pending.json` (or
  `$FLUME_DIR` inside an inline-exec, which inherits the env). `{{FLUME_DIR}}`
  is reserved and dispatcher-authoritative: a `promptArgs` value of the same
  name cannot shadow it.
- **`promptArgs(ctx)`** also receives `ctx.flumeDir` if you need to derive a
  path programmatically.

`process.env.FLUME_DIR` is still set — the CLI canonicalizes the resolved root
back into it — but that write-back is the **child-process channel**: it is how
a spawned agent, a gate's shell, and a loop-spawned tick child inherit one
answer. `$FLUME_DIR` inside an inline-exec is the sanctioned read, because the
reader there really is a child process. The chain itself is handed the same
values by reference and has no reason to go looking.

**The boundary:** chain-load (placement, `writablePaths`) →
`flume.paths.flumeDir` / `flume.paths.stateRootRel`; tick time (gates,
prompts) → `ctx.flumeDir` / `ctx.stateRootRel` / `{{FLUME_DIR}}`; a spawned
child → the inherited env. Hardcoding `.flume/` in
a gate, prompt, or `writablePaths` breaks under a relocated `flumeDir` — the
dispatcher reads `<flumeDir>/plan/` while your hardcoded site points at
`.flume/plan/`, and the tick's writes land where the harness isn't looking.

### Wiring into the dispatcher

The chain doesn't reference the agent — the dispatcher does. The shipped
`bin/flume` wires the default agent against `.flume/chain.ts`; you only
invoke `Dispatcher` yourself for non-standard hosts (tests, custom CLIs):

```ts
import { resolve } from "node:path";
import { Dispatcher, consoleLogger } from "@dtmd/flume";

// No prebuilt chain: the dispatcher resolves <configDir>/chain.ts in its
// own process, once at the start of every tick — no in-process memo or
// cache-bust (each `flume tick` is a fresh process).
const dispatcher = new Dispatcher({
  agent,
  log: consoleLogger,
  repoRoot: process.cwd(),
  configDir: resolve(process.cwd(), ".flume"),
});
await dispatcher.tick();
```

## 5. The prompt template format

A prompt file is markdown plus two extensions the renderer applies
per-tick.

### Placeholders: `{{KEY}}`

`{{UPPER_SNAKE_CASE}}` is replaced from the phase's `promptArgs(ctx)`
return value:

```md
<entry>
{{ENTRY_JSON}}
</entry>

The "why" cite: `{{PER_PATH}}` § `{{PER_SECTION}}`.
```

Keys must start with an uppercase letter and contain only `A-Z`, `0-9`,
`_`. If the prompt references a key `promptArgs` doesn't supply,
`renderPrompt` throws — mismatched contracts fail fast.

### Inline-exec: `` !`shell command` ``

Backtick commands prefixed with `!` execute in the tick's `cwd` and are
replaced with stdout (trimmed). The prompt bakes in dynamic context
without round-tripping through `promptArgs`:

```md
<recent-commits>
!`git log -n 5 --oneline`
</recent-commits>

<pending-json>
!`p="{{FLUME_DIR}}/plan/pending.json"; test -e "$p" || { echo "[]"; exit 0; }; cat "$p"`
</pending-json>
```

That second span is the idiom for an artifact whose **absence is
legitimate** and whose unreadability is not. The guard tests for the
artifact and selects the placeholder explicitly, exiting zero; everything
past the guard is a real read, so a path that exists and still fails to
open — a directory where a file belongs, a permission denial — reaches the
renderer as a refusal instead of rendering the same placeholder. A trailing
`|| echo` cannot draw that line: it answers both cases identically, and the
tick proceeds over an artifact it never read.

Notes:

- The command text reaches `sh` through **stdin**, not argv — `sh` is
  spawned with no command-line arguments and the command is written to its
  stdin then closed. Pipes, redirects, and `||` all still work, since `sh`
  itself parses the text. (`execFile("sh", ["-c", cmd])` corrupted any
  non-ASCII byte in `cmd` on win32 under MSYS2's re-parsing of the Windows
  command line; stdin transport doesn't.)
- Consequence: **`sh` consumes stdin**, so a span whose own command reads
  stdin sees EOF instead of any inherited input. Don't write a span that
  depends on reading stdin.
- **A `{{KEY}}` inside a span is shell text, not a shell word.** Placeholders
  are substituted before the span runs, and the renderer neither quotes nor
  escapes what it substitutes — the engine cannot know a value was meant as
  one word. Quote it yourself (`` !`cat "{{PENDING_PATH}}"` ``), or a state
  root carrying a space or a backslash word-splits before `sh` opens the file.
- All inline-execs run in parallel; don't depend on ordering between them.
- Output is capped at 4 MiB.
- **A span that fails to resolve — non-zero exit, spawn failure, `sh` not
  found, or a cap overrun — aborts the whole render.** The agent is never
  invoked; the error names every failing span's command text and its
  stderr, and the tick classifies as a no-commit outcome (`render-refused`)
  distinct from the agent's own `clean-exit`, which it never reached. There
  is no substituted placeholder and no partial send —
  every span in a prompt is load-bearing. An empty-but-successful command
  (`git diff` with no changes) is not a failure: exit status decides, never
  output length. Keep spans command lines you're confident will succeed;
  a command that can legitimately fail belongs behind `promptArgs`-level
  handling in the chain, not inline-exec.

### The `<harness>` block

The renderer prepends a `<harness>` block to every prompt with the phase's
declared capabilities. On an entry-scoped fanout tick (one carrying an
`assignedEntry`), it states the **effective** fence the write guard will
actually enforce — `entry.files ∪ phase.entryChannelPaths` — separately
from `phase.writablePaths`, the outer ceiling both checks must clear
(`spec/prompt.md`, "The harness block"):

```text
<harness>
Phase: build
Concurrency: fanout
Effective fence (your commit may touch exactly these; anything else reverts the commit whole):
  - src/Foo.ts
  - tests/Foo.test.ts
Outer ceiling (also enforced, independently of the fence above — a path must clear both):
  - src/**
  - tests/**
Gates (run automatically after your commit):
  - tsc (afterCommit)
  - vitest (afterCommit)
</harness>
```

A singleton tick, or a fanout tick with no `assignedEntry`, gets the
unscoped rendering instead — unchanged from before §2:

```text
<harness>
Phase: build
Concurrency: fanout
Writable paths (anything else you modify will revert the commit):
  - src/**
  - tests/**
Gates (run automatically after your commit):
  - tsc (afterCommit)
  - vitest (afterCommit)
</harness>
```

You don't write this block — the harness injects it. The contract: your
prompt states the task and output shape; the harness states what it will
enforce. Don't reiterate writable paths in your prompt.

### The `<prior-attempt>` block

When a tick leaves the queue unchanged, the next tick scheduled for the same
entry (fanout) or phase (singleton) gets a `<prior-attempt>` block right after
`<harness>`. The record behind it is a mode-tagged union — exactly one variant
per record — and the block renders the variant that fired:

- `gate-revert` — the commit landed and a gate reverted it. Carries which gate
  phase reverted (`afterCommit` or `afterMerge`), the failing gate's `name`,
  its one-line `message`, its full `details`, and a `git show --stat` digest of
  the reverted commit. Symmetric across both gate phases: an `afterMerge`
  failure dies with the dispatcher process, and this is what survives it.
- `clean-exit` — the agent exited cleanly and committed nothing. Carries the
  tail of the agent's own final message, verbatim. The engine names no intent:
  a refused constraint, a deliberate park and "nothing to do" all exit clean,
  and the message is yours to read.
- `platform-preempt` — the agent process failed for non-work reasons
  (rate-limit, auth, per-tick timeout, dispatcher-killed). Carries the failure
  class, marked as explicitly **not** a defect in the prior work — the retry
  resumes rather than treating the cut-off as a wall.
- `render-refused` — the tick refused before invoking the agent: either one or
  more inline-exec spans failed to resolve, or a pre-invocation hook
  (`shouldRun`, `promptArgs`) threw. Carries every failing span's command text
  and its stderr, or the hook that threw and what it said.
- `tip-moved` — the agent's own commits failed the ancestry check: the base its
  private `flume/**` branch started from was no longer an ancestor of the HEAD
  the agent left, so the span was soft-reset away on that branch. Carries both
  shas — the recorded base and the observed HEAD itself, never the HEAD's
  parent, so the agent's top commit stays discoverable. Like `platform-preempt`,
  not a defect in the work. This is the only leg that writes the record: a wave
  that refuses to cherry-pick because another process holds a live claim on the
  tip reports `tipMoved` as a tick fact and writes nothing here, because nothing
  was discarded — the commit is still sitting on its worktree branch.
- `not-shipped` — the commit landed, passed every gate, and your own `shipped`
  predicate then did not ship it: it returned `false`, or it threw. Carries the
  merged sha, the paths that commit touched, and `threw` — the message a
  throwing predicate raised, absent when it deliberately returned `false`, so a
  broken hook never reads back as a park. No reason vocabulary beyond that: the
  engine records that the chain said no, never why. This is what a chain reads
  instead of rebuilding "was the last attempt a park" out of the verdict log.

Rendered, for the `gate-revert` variant:

```text
<prior-attempt>
A previous attempt at this work committed and was REVERTED by a gate.
Read the failure below and change your approach — do not blindly
reconstruct the reverted change.
Reverted at: afterCommit
Failing gate: tsc
Verdict: tsc failed (3 errors)
Gate details:
  src/Dispatcher.ts(412,7): error TS2322: ...
Reverted change digest (git show --stat):
  build: wire prior-attempt persistence
   src/Dispatcher.ts | 48 ++++++++++++++++--
   1 file changed, 44 insertions(+), 4 deletions(-)
Recorded 2026-03-04T11:22:31.004Z, trunk tip 9f2c1ab.
</prior-attempt>
```

Like `<harness>`, this is dispatcher-owned and structural — there is **no
`{{token}}` for it** and you don't reference it in `promptArgs` or the prompt
file. For `gate-revert`, both the gate `message` and its `details` feed the
block — write `details` for the retrying agent to read (concrete paths and
line numbers beat narration).

**Every record is anchored.** Whatever the variant, it carries `headSha` — the
trunk tip when the record was written — and `at`, an ISO timestamp, rendered
as the block's last line. A chain deciding "it bailed, and nothing has changed
since" compares `headSha` against the current tip, never the record file's
mtime against a commit time.

**A gate that authored a `verdict` keeps it on the record.** A `gate-revert`
record carries the failing gate's `verdict` (above, §2) verbatim beside its
`message`, absent when the gate authored none. A `shouldRun` deciding whether
to retry reads that field off `TickContext.priorAttempts` rather than
pattern-matching the rendered prose. The block above renders `message` and
`details` only — `verdict` is for the hook, not the agent.

**A gate that names its failing files earns a flake marker.** When a
`gate-revert` record's gate returned `failingFiles` (above, §2) and every file
it named is disjoint from the reverted span's own footprint, the record carries
`suspectFlake: true` — the entry's own edits cannot have caused a failure in
files they never touched. It is derived, never trusted: the dispatcher computes
it from the two lists, and a gate reporting no `failingFiles` earns no marker.
An absent field is never a claim of flakiness.

The carry is cross-process by construction — the record is persisted under
`.flume/prior-attempts/<keyspace>/` (gitignored, beside the baton;
`priorAttemptPath(flumeDir, ref)` is the exported rule, the ref pairing the
keyspace with the identity) and read back by the
next `flume tick`'s fresh process. That same read hands every record to your
hooks as `TickContext.priorAttempts`, keyed by the keyspace and identity each
record was written under — `entry:<tag slug>` for a fanout record,
`phase:<phase name>` for a singleton one, your spelling of that name rather
than the slugged stem the file sits at — so a
`shouldRun` or `promptArgs` reading one — the `suspectFlake` marker included —
never opens the directory itself. The join is the package's, not yours:
`entryAttemptKey(entry)` spells the key for a queue entry you hold, and
`recordAttemptKey(record)` spells it for a record you pulled back out of the
map, so nothing outside the engine composes `<keyspace>:<identity>` by hand.

The block is **absent on a first attempt** (no false signal), and a record
clears two ways: an attempt that **ships clean** retires its own, and a
**fanout wave's queue read** retires every entry-keyed record whose tag the
queue no longer carries. That second clear runs before selection, so an entry
you dropped or renamed in `pending.json` leaves nothing behind for a later tick
to read — the retry those records were written for is never going to happen.
The wave names the keys it cleared on the tick verdict
(`clearedPriorAttempts`, absent when it cleared none — the same
`entry:<tag slug>` keys the map uses); a singleton phase's own record is
outside that sweep, since no queue entry governs it, even where its name slugs
onto a tag the queue has dropped.

## 6. The foundations governor (`forkResolver`)

A `gate: open` entry means "schema-valid, not blocked by a sibling entry." It
does **not** mean "the product/UX decision this work rests on is settled." When
an entry cites a spec section whose decision is still an open question, building
it ships a surface onto an undecided foundation. The foundations governor closes
that gap.

Two pieces wire it up:

1. **Plan declares the dependency.** A pending entry whose work rests on an open
   question carries `dependsOnForks: ["slug", ...]` — opaque slugs your project
   uses to key its open questions. The entry is skipped while any slug is
   unresolved, regardless of gate kind, and picked up automatically once they
   resolve. No new gate state; foundations cross-cut the gate.

2. **The chain supplies a resolver.** `DispatcherOptions.forkResolver` answers,
   per repo, "is this slug resolved?" The runtime is format-agnostic — it never
   reads your open-questions file itself; it calls your predicate. A chain that
   supplies no resolver is unaffected (every fork is treated as resolved).

```ts
// Where you construct the Dispatcher / assemble DispatcherOptions.
forkResolver: (repoRoot: string) => {
  const text = readFileSync(
    join(repoRoot, ".flume/plan/open-questions.md"),
    "utf8",
  );
  return (slug: string) => {
    // Match `(slug` at a boundary — tolerate `(slug)`, `(slug,`, `(slug —…`,
    // but never let a short slug match a longer one (`(foo` ≠ `(foo-bar`).
    const esc = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\(${esc}(?![-A-Za-z0-9])`);
    const line = text.split("\n").find((l) => re.test(l));
    // Fail OPEN: an absent slug (answered and deleted) or a typo must never
    // permanently wedge its dependents — treat it as resolved.
    return !line || /\bRESOLVED\b/.test(line);
  };
};
```

**Fail open, never closed.** The recommended resolver treats an **absent** slug
as resolved (a fork answered and removed should _unblock_ its dependents) and an
**unknown/mistyped** slug as resolved (a bookkeeping error must never block the
loop forever). Every degradation is a _missed block_ — a surface that builds one
tick early — never a stuck loop. The runtime takes no position here; the bias
lives in your resolver.

**What happens when an entry is fork-blocked:** it is simply not selected this
tick. The dispatcher builds a foundation-settled sibling instead
(skip-to-settled); if _every_ `open` entry is fork-blocked, the tick idles with
no commit and the phase advances — a loud, visible signal (in `flume status`)
that the next move needs a human decision, which is strictly safer than shipping
onto sand. A fork-blocked entry is never marked failed and never reverted.

## 7. Capability gating (`requiresCapability`)

A `gate: { kind: "requiresCapability", capability: "docker-host" }` entry is
pickable only when the chain has asserted that capability. Unlike the
foundations governor (§6), which cross-cuts every gate kind, this is a gate
kind itself — mutually exclusive with `open`, `blockedBy`, `parked`,
`deferred`.

Two pieces wire it up:

1. **Plan declares the gate.** An entry whose work needs an environment fact
   the runtime cannot assume — a running daemon, a bound port, a mounted
   volume — carries `gate: { kind: "requiresCapability", capability: "..." }`
   instead of `open`.
2. **The chain asserts what's available.** `Chain.capabilities?: string[]` —
   the environment facts this chain has verified. `chain.ts` is TypeScript,
   so it may probe the environment at load time:

```ts
import { execFileSync } from "node:child_process";

function dockerHostAvailable(): boolean {
  try {
    execFileSync("docker", ["info"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const chain: Chain = {
  phases: [plan, build],
  humanOnly: [],
  capabilities: dockerHostAvailable() ? ["docker-host"] : [],
};
```

An entry gated on an unasserted capability is skipped, never silently —
`flume status` names the missing capability so a human sees why the queue is
stuck on it, rather than reading a bare `hibernating`/`awake` line and
guessing.

`backlog-groomer-chain.ts` uses the same gate kind for a non-infrastructure
capability — a backlog item can require `"ops-access"` just as easily as a
docker host; the engine's mechanism doesn't care what the string names, only
whether the declaring chain asserts it.

## 8. Reading tick history: `readTickVerdicts`

Every tick that actually runs a phase writes one **verdict** — a facts-only
record of what happened: phase name, entry tags, committed/no-commit class,
every gate that ran (name, ok/fail, message, and for a failing gate its
`details` — e.g. a writable-paths violation's offending paths), shipped
tags, and (fanout) each provisioned entry's cherry-pick/merge fate. The
engine writes it; nothing in the shape says what the facts *mean* — no
`park`, no `bail worth waking for`. That interpretation is the chain's job.

`readTickVerdicts(flumeDir, n?)` (exported from `flume`, alongside the
`TickVerdict` / `ReportedGateResult` / `TickVerdictMergeOutcome` /
`MergeOutcome` types it returns) reads the last `n` verdicts, oldest first,
from the bounded on-disk history log — default `n` is the log's own cap
(200). Absent or corrupt history reads as `[]`, never a thrown error.

A chain that wants a phase's prompt to carry recent tick history renders it
itself, from `promptArgs`:

```ts
const factory: ChainFactory = (flume) => {
  const { readTickVerdicts } = flume;

  const plan: Phase = {
    name: "plan",
    // ...
    async promptArgs(ctx) {
      const recent = await readTickVerdicts(ctx.flumeDir, 5);
      const lines = recent.map(
        (v) =>
          `${v.phaseName}: ${v.committed ? "committed" : (v.noCommit ?? "no-op")}` +
          (v.shippedTags.length ? ` (shipped ${v.shippedTags.join(", ")})` : ""),
      );
      return { RECENT_TICKS: lines.join("\n") || "(no prior ticks)" };
    },
  };

  // ...
};
```

Whether to render history at all, how far back, and what to do with a
reverted tick's `gateResults[].details` (surface it verbatim? summarize it?
ignore it?) are the chain's calls, not the engine's — same split as every
other prompt-args decision (§1).

## 9. Supervisor policy (`supervisorPolicy`)

`flume loop`'s supervisor runs a deterministic-failure safety net around every
tick, singleton and fanout alike. It accounts for every per-entry failure fact
the tick verdict records, keyed by **stage-tagged signature** — `provision` (a
pre-tick worktree sweep, create, or `setupWorktree` throw), `merge` (a
cherry-pick conflict or a dirty trunk refusing the pick), and `gate` (a gate
revert). The two legs reach different failures: an entry a failure can be
**blamed** on is quarantined for the rest of the run, whichever stage it failed
at, so the supervisor stops re-attempting a wall it already hit (entry-keyed,
so fanout's in practice), and a consecutive-identical-failure backstop aborts
the run outright when the same stage-tagged signature repeats with no clearing
tick in between — the non-entry-scoped class quarantine can't isolate, which is
a repo-level failure like `git worktree prune` *and* every singleton failure,
since a singleton tick has no entry to blame.

Beside the net, the block carries the knobs that shape the tick itself and
have nowhere else to be set from a chain: how wide a fanout wave runs, the
wall-clock cap on one agent invocation, the paths the fanout partition
ignores, and the grace a signalled tick gives the agent tree it started before
it stops waiting. Each knob ships as an engine default; `Chain.supervisorPolicy`
lets a chain choose otherwise:

```ts
const chain: Chain = {
  phases: [plan, build],
  humanOnly: [],
  supervisorPolicy: {
    quarantineScope: "none",
    abortThreshold: 5,
    killGraceMs: 30_000,
    maxParallel: 2,
    tickTimeoutMs: 45 * 60_000,
    partitionIgnore: ["pnpm-lock.yaml"],
  },
};
```

- **`quarantineScope`** — `"run"` (default): a tagged failure at any of the
  three stages quarantines that entry for the rest of the run, under the key
  the failing tick reported — its slug plus a hash of its bytes in
  `pending.json`, so a re-scope on trunk is a new key and lifts the hold.
  Later ticks skip it without touching `pending.json`, so a fresh run
  retries it from scratch. `"none"` disables quarantine outright: every
  entry stays pickable every tick regardless of an earlier failure. The
  consecutive-failure backstop below still applies either way — `"none"`
  only removes the per-entry isolation, not the run-level safety net. Bound
  **once per run**: the quarantine set is accounting that accumulates across
  the run.
- **`abortThreshold`** — the number of consecutive ticks the same
  stage-tagged failure signature must repeat, with no clearing tick
  between them, before the supervisor aborts the run rather than burning
  the remaining `--max` ticks against the same wall. Default 3. Bound **once
  per run** too: the streak is accounting that accumulates across the run.
- **`killGraceMs`** — milliseconds between the `SIGTERM` a signalled `flume
  tick` sends the agent tree it started and the `SIGKILL` that follows — the
  window an agent mid-invocation gets to finish writing under the state root.
  A tree that exits on the `SIGTERM` never reaches it. It is the **one timer
  over a signalled run**: a `flume loop` signals its tick child's group and
  waits on that child unbounded, because the agent leads a group of its own
  and a timer at the supervisor would kill the child before its escalation
  reached that agent (`spec/loop.md`, "The loop lock and the tip claim"). So
  this is what a `Ctrl-C` costs when a well-behaved-but-slow agent is what
  holds it up; a tick wedged past its own handler holds the run open instead
  of releasing over a live writer, and the operator kills it — the next
  acquirer's liveness probe reclaims the claim. Default 5000. POSIX only:
  win32 maps `SIGTERM` to `TerminateProcess`, which runs no handler, so there
  is no disposition for a grace to bound. Read **per tick**, because the timer
  belongs to the process that can see the tree it is timing: a `flume tick` —
  bare or loop-spawned — signals the agent it started, and the supervisor
  above it holds no grace of its own.
- **`maxParallel`** — how many entry ticks one fanout wave starts at once.
  Default 4. The partition (§3) decides which entries *may* share a wave —
  disjoint declared files — and this decides how many of that set actually
  run together; the rest wait for the next wave. Lower it when the agent seam
  is rate-limited or the machine has fewer cores than the wave has entries,
  raise it when ticks are cheap and cherry-picks land clean. A singleton
  chain never reads it. Read **per tick**.
- **`tickTimeoutMs`** — wall-clock cap on one agent invocation, in
  milliseconds. Default unset: **no cap**, which means the only brake on a
  runaway invocation is an operator watching verdict lines. Exceeded, the
  invocation is aborted and the tick records the abort like any other failed
  tick, so the signature accounting above sees it and the run's `--max`
  budget is not burned silently against a hung agent. Derive the value from
  measured invocations with headroom over the observed maximum — a cap set at
  the maximum kills the next slow-but-healthy tick. Read **per tick**.
- **`partitionIgnore`** — globs, matched by the same matcher `writablePaths`
  goes through (§1), whose paths never count toward the fanout partition's
  collision set. Default `[]`, byte-identical to no filter. A file every
  entry touches — a lockfile, a generated index, a shared changelog —
  otherwise collides with every other entry and serializes each wave down to
  a single tick; naming it here keeps the wave wide. This widens only what counts as a *collision*, never a
  permission: the fence, the write guard, and ship detection all still read
  that path in full (`spec/pending.md`, "Fanout partition — disjoint touched
  paths"). Read **per tick**.

Every field here is optional and independent; a chain declaring none gets the
engine defaults, byte-identical (`spec/loop.md`, "Repeated identical
failures — quarantine, then abort").

**The fields split into two binding classes, and a self-editing chain feels
the difference.** Each bullet above says which class its knob is in; what the
class costs is the same either way.

A field **bound once per run** is resolved by `flume loop`'s supervisor in its
own process before the first child, and nothing re-reads it between ticks — so
a tick that commits a changed value is governed by the old one until the
operator restarts the loop, with no indication the new declaration was
ignored. That is the point rather than an oversight: a once-per-run knob
governs accounting that accumulates across the run, and a mid-run change would
rewrite the rules the accumulated counts were gathered under.

A field **read per tick** is taken straight off the tick's own resolved chain
— the dispatcher reloads `chain.ts` fresh every tick and a per-tick knob
accumulates no run-scoped state — so a mid-run change governs from the next
tick onward (`spec/chain.md`, "Supervisor policy is a chain-overridable
default").

A chain that fails to load at supervisor start surfaces nothing new here: the
defaults apply for that run and the first child tick still reports the load
failure exactly as it does today.

## 10. Declaring an entry extension (`entryExtension`)

The engine's pending-entry schema is deliberately small: `tag` (identity),
`files` (the fence declaration), `gate` + `blockedBy` + `dependsOnForks`
(pickability), and the dispatcher-maintained `observedFiles`. That is
everything the engine mechanically consumes; it validates nothing else and
it renders nothing else. Whatever additional fields your workflow wants on
an entry — a summary, a spec citation, acceptance criteria — are yours to
declare.

Each field's declared type is a [Standard Schema](https://standardschema.dev)
validator (`~standard`) — zod ≥3.24, valibot, and arktype all publish one, and
a hand-written object works too. The engine never imports or merges your
schema object into its own; it only calls `~standard.validate` on it at parse
time. zod is what this doc's examples use because it's the ecosystem default,
not because the engine requires it.

Declare each field **once**, with both its validator and its prompt hint:

```ts
import { z } from "zod";
import type { EntryExtension } from "@dtmd/flume";

const entryExtension = {
  summary: {
    schema: z.string().min(1).max(200),
    hint: `"one-line what (≤200 chars)"`,
  },
  per: {
    schema: z.strictObject({
      path: z.string().min(1),
      section: z.string().min(1),
    }),
    hint: `{ "path": "specs/.../foo.md (the spec that justifies this work)", "section": "Section heading text" }`,
  },
} satisfies EntryExtension;

const myChain: Chain = {
  phases: [plan, build],
  entryExtension,
};
```

The single declaration drives both enforcement surfaces, so the prompt and
the parser cannot drift:

- **Validation** — the dispatcher *adapts* each declared validator (calling
  its `~standard.validate`, never merging its schema object) into the
  composed entry schema; `parsePending(raw, entryExtension)` does the same
  in your own gates. The composed schema is strict: a field that is neither
  core nor declared fails loudly. (Silent stripping is how plan-authored
  fields would get destroyed when the dispatcher rewrites `pending.json`
  on ship.) A validator's `~standard.validate` must be synchronous —
  `parsePending` cannot await it, and an async validator is refused at
  first parse, naming the field.
- **Rendering** — `renderSchemaForPrompt(entryExtension)` renders the core
  shape followed by each declared field as `"<name>": <hint>`, verbatim.
  Pass it through your plan phase's `promptArgs` exactly as before.

To read a declared field with types in your chain code, your own schema
object is untouched — call `.parse()` on it exactly as you would outside
flume, since you own that object and its concrete type:

```ts
const per = entryExtension.per.schema.parse(ctx.assignedEntry.per);
```

A chain that declares no `entryExtension` gets the bare core — entries
carry only the mechanical fields, and anything extra is rejected.

The extension isn't cascade-specific machinery — `backlog-groomer-chain.ts`
declares its own, one field (`reason`), and validates a completely
different queue (`BACKLOG.json`, not `pending.json`) against
`composePendingList`/`parsePending` the same way. Same composition, no
plan/build split in sight.

## 11. Refining the tag grammar

The engine requires of `tag` only what its mechanics need: a conservative
charset (letters, digits, `._()-`), no whitespace, and a length bound
derived from the tightest place the engine writes a raw tag into a
filename (a worktree/branch slug, a revert-note filename). That's
mechanical safety, not house style — `DAL-REWIRE(usp_Filter_Get)` validates
against the bare core.

A chain wanting a stricter convention (an ALL-CAPS naming scheme, a
required prefix, whatever your team's grammar is) declares it as a `tag`
entry in `entryExtension` — the one core field name the extension is
allowed to declare. It composes as an **intersection**, not a replacement:
both the engine's mechanical floor and your schema must pass, so your
refinement can only narrow the grammar, never widen past (or disable) the
engine's own safety check.

```ts
const entryExtension = {
  tag: {
    schema: z.string().regex(/^[A-Z][A-Z0-9]*(?:[-.][A-Za-z0-9]+)*(?:\([a-z0-9]+\))?$/),
    hint: `"ALL-CAPS-WITH-DASHES" | "TAG-NAME(slice)"`,
  },
  // ...your other declared fields
} satisfies EntryExtension;
```

`renderSchemaForPrompt` renders whichever constraint is actually in force —
the core hint alone with no `tag` entry declared, or the core hint plus
your refinement's `hint` when one is — so the plan prompt and the parser
never disagree about what a valid tag looks like.

`backlog-groomer-chain.ts` refines `tag` the opposite direction from
cascade's ALL-CAPS convention above — lowercase-kebab
(`/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/`). Both refinements compose against the
identical mechanical floor; the engine has no opinion on case.

## 12. Declining one entry at selection (`refusesEntry`)

The gate kinds above are the *entry's* declaration of when it may be picked.
`Chain.refusesEntry` is the chain's: a predicate the engine consults for every
entry the gate switch (and this run's quarantine) has already cleared, at
selection time, before any worktree exists.

```ts
const chain: Chain = {
  phases: [plan, build],
  humanOnly: [],
  // Never re-dispatch an entry whose last attempt exited cleanly against the
  // tip we are still on: the same dispatch against an unchanged world is the
  // same outcome, at full agent price.
  refusesEntry: ({ priorAttempt, headSha }) =>
    priorAttempt?.mode === "clean-exit" && priorAttempt.headSha === headSha,
};
```

Answered `true`, the entry is held back from every pickable set the tick
reports — the wave's own batch, `TickContext.pickable`, and
`TickResult.pickableAfter` — and its tag is named on
`TickResult.refusedTags`. Answered `false`, nothing changes. Declaring no
predicate at all refuses nothing, and `refusedTags` is `[]`.

What the predicate is handed (`EntryRefusalContext`) is every fact the engine
already holds about the entry at that moment, so it reaches for none itself:

| Field | What it carries |
| ----- | --------------- |
| `entry` | The entry as this tick read it from the queue — tag, gate, files, and whatever your `entryExtension` declared. |
| `priorAttempt` | The entry's own latest prior-attempt record, or absent on a first attempt. The same record `TickContext.priorAttempts` carries under `entry:<tag slug>`, decoded by the engine's own reader. |
| `headSha` | The trunk tip this selection was taken at — the number to compare a record's `headSha` anchor against. |

Three properties worth knowing before you declare one:

- **It runs at selection, not after dispatch.** A refused entry costs a
  predicate call, not a worktree and an agent invocation. That is the whole
  reason to prefer it over declining inside the agent's own tick.
- **It is consulted more than once per tick** — once for the set the tick
  opens on, and again for the post-tick `pickableAfter` the handoff routes
  on, that second pass judged against the tip and the records as they stand
  *after* the tick. Keep the predicate pure and cheap; it is not an async
  seam, and a predicate that throws fails the tick rather than being read as
  a refusal.
- **The refusal is yours, and so is what it means.** The engine reports which
  entries you held back and nothing about why — no reason field, no verdict.
  A `handoff` that wants to act on a refusal (wake a phase that can re-scope
  the entry, or hibernate rather than re-picking it) reads `refusedTags`
  beside `pickableAfter`.

## Putting it together

```ts
const factory: ChainFactory = (flume) => {
  const { pendingGate, tscGate, vitestGate, eslintGate, shellGate } = flume;

  // ... phases defined here, composing with the destructured values ...

  const cascadeChain: Chain = {
    phases: [plan, build],
    humanOnly: [],
  };
  return { chain: cascadeChain };
};

export default factory;
```

Everything that needs an engine value lives inside the factory; anything
that does not — a `zod` entry extension, plain constants — can stay at
module scope. `examples/cascade-chain.ts` is this shape end to end.

`phases` is the ordered list, and the order is a contract: the first phase
is the chain's entry point, by position rather than by name (machinery never
hardcodes a phase name). Put the phase a cold start should begin with first;
cascade leads with `plan` because a fresh state root must derive pending
before anything can build.

`humanOnly` lists phases the dispatcher
cannot wake via another phase's `handoff` — humans wake them by touching
`.flume/awake/<name>` (or `flume wake <name>`). Reach for it when a phase
consumes something a human authors between runs, so waking it from a
sibling's handoff would only burn a tick. Cascade declares it empty: both
its phases derive from disk, so either is safe to wake autonomously.

## Where to look next

- [`examples/cascade-chain.ts`](../examples/cascade-chain.ts) — the
  flagship plan → build derivation chain this walkthrough quotes from.
- [`examples/backlog-groomer-chain.ts`](../examples/backlog-groomer-chain.ts) —
  the peer example chain: single-phase, no plan/build split, its own
  entry extension and tag refinement on the same engine. See the intro
  above for the framing.
- [`examples/minimal-chain.ts`](../examples/minimal-chain.ts) — the
  single-phase starter.
- [`harness/`][living-harness] in the flume repository — the harness
  package's source: the chain a consumer adopts instead of writing one, and
  the tree that moves first when the engine changes. Its contract is
  `spec/harness.md`.
- [`.flume/declaration.ts`][living-declaration] in the flume repository —
  the living reference for the *harness declaration*: flume's own
  environment, declared against the package it ships.
- [`docs/INTENT.md`](INTENT.md) — design rationale.
- [`docs/CLI.md`](CLI.md) — every `flume <subcommand>` with exit semantics.
- `src/Phase.ts`, `src/Gate.ts`, `src/Agent.ts`, `src/Prompt.ts`,
  `src/PendingSchema.ts` — JSDoc on these types is the authoritative
  reference once you're past this introduction.
