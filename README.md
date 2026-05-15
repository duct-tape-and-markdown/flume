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
npm install @<scope>/flume
```

Drop a `.flume/chain.ts` into your repo:

```ts
// .flume/chain.ts
import type { Chain, Phase } from "flume";
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

## Concurrency

Phases declared `concurrency: "fanout"` partition their pending entries by
file overlap (`partitionByFileOverlap`). Disjoint entries spawn parallel
worktrees; each worktree runs its agent invocation and `afterCommit` gates in
isolation. When the wave finishes, the dispatcher merges into the trunk in
commit order and runs `afterMerge` gates against the merged state. A cherry-pick
conflict keeps that entry in pending; an `afterMerge` failure reverts the
whole wave.

Worktrees are the only isolation primitive in v0.1. Docker / sandbox layers
are deferred.

## Where state lives

Everything is on disk under `.flume/`:

- `.flume/awake/<phase>` — baton flag files. Presence = phase is awake.
- `.flume/plan/pending.json` — structured handoff between plan and build.
- `.flume/plan/state.md`, `.flume/plan/open-questions.md` — prose scratch
  that survives across ticks.
- `.flume/inbox.md` — transient findings queue drained by plan.
- `.flume/worktrees/<phase>/<entry>/` — per-entry worktrees during fanout.
- `.flume/sessions/<timestamp>.jsonl` — captured agent NDJSON (opt-in via
  `withSessionCapture`).

Ticks read these on entry and write them on commit. Across ticks, the disk is
the only carrier of state.

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
- [`examples/minimal-chain.ts`](examples/minimal-chain.ts) — single-phase
  starter.
- [`examples/cascade-chain.ts`](examples/cascade-chain.ts) — multi-phase
  workshop → spec → plan → build pipeline.

## License

MIT. See [`LICENSE`](LICENSE).
