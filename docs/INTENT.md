# Flume — Intent

> **Current reference.** Describes flume as it ships now; every spec cite
> names a live `spec/*.md` section.

## What Flume is

A library for orchestrating AI-derivation pipelines as a sequence of disciplined, disk-rooted phases.

Each phase is one agent invocation. Each invocation reads committed artifacts, produces a commit (or zero), and signals which phase wakes next. The harness enforces what gets written, what passes, and what hands off — the prompt only states what to produce.

## The spine

**Prompts say what the agent does. The harness guarantees what gets enforced.**

This split is load-bearing. Anything a prompt can drift on, the harness owns:

- **Output shape.** Phase outputs conform to typed schemas. Malformed output → commit rejected, phase re-runs with the parse error as context.
- **Capability scoping.** Each phase declares `writablePaths`. Post-commit, the harness diffs the commit against the declaration and reverts on violation.
- **Validation gates.** `tsc`, tests, lint, custom — composable gate functions, declared per phase, run by the harness.
- **Baton.** Filesystem flags at `.flume/awake/<phase>` signal what wakes next. Presence wakes; absence hibernates.
- **Provenance.** The extension point, not the citation. A chain declares its own pending-entry fields (`Chain.entryExtension`, one declaration driving both the validator and the prompt hint); the engine runs the validator it was handed and never reads what the field means. This repo's chain spends that point on `per` — a `{ path, section }` cite into `spec/` or `.claude/rules/` — and enforces it with its own `per cites resolve` gate (`.flume/chain.ts`), which checks the path is in the gated commit and the section is a heading in it. Inter-layer citation discipline is a chain's to define and gate; the harness ships the seam that lets it.

### Committed state is the loop's memory

Each tick reads the disk, does work, and commits. The next tick starts from what the last one left, and that accumulation **is** the mechanism: a chain converges by iterating against committed state, not by any single tick being correct. This is why **pipeline state — `pending.json`, plan prose — is committed on purpose, not as bookkeeping**: it is what the next iteration reads.

It follows that discarding a tick's commit discards *progress*, not merely a bad write. A revert is a real cost paid to keep the tree working — never a routine control-flow step, and never the price of a bookkeeping mismatch. Work that ran, passed its checks, and moved the tree toward the goal stays on the disk the next iteration reads. Where a harness must choose, it iterates again over imperfect state rather than resetting to clean state; the loop's job is to reach the end result, not to make each step conform to a prediction of it.

A consequence for anything built on flume: a layer that wants *ephemeral* pipeline state (run, then leave no trace) cannot get there by **un**committing — that deletes the memory each iteration depends on. It gets there by **disposing of the commits**: confine them to a throwaway branch/ref and extract only the real deliverable at teardown. Disposable ≠ uncommitted. Where the committed state *lives* is relocatable (`flumeDir`); *that* it is committed is not.

## What stays prose

Specs, rules pages, ADRs, READMEs, plan-State summaries, open-questions lists, findings records. These are documentation surfaces for humans and prose-aware agents. Markdown is correct here.

## What becomes JSON

Anything the dispatcher mechanically consumes — Pending entries, gate results, ledger snapshots, phase handoff signals. One schema, four enforcement points (parse, validate, prompt-inject, type-input). No handrolled parsers.

## Non-goals

- **Session continuity.** Reintroduces in-memory state the protocol exiles. Every tick is fresh.
- **In-agent iteration.** A tick is one invocation. The dispatcher decides re-runs.
- **Hardcoded chain.** Spec → plan → build is one default, not the framework.
- **Multi-provider agent abstraction (v0).** Claude-only via `claude -p`, single named seam for later swap.

## Parallelism

Built-in from v0 via git worktree fanout for phases declared `concurrency: "fanout"`. Disjoint-by-`Files:` Pending entries fan out into per-entry worktrees, each runs its agent invocation + gates in isolation, then merges into the trunk in commit order with a post-merge gate. No Docker required; worktrees are the isolation primitive.

Docker is a v1 layer for AFK / env reproducibility / capability isolation, behind the same `SandboxProvider` seam.

## Decided, not yet executed — the consumable chain

Ruled 2026-09-14 on the consumer chain survey
(`docs/surveys/consumer-chains/`, five consumers read against 0.15.0). The
engine ships as a package; the harness that runs it does not, so every
consumer re-authors it and every breaking engine change is one hand
migration per consumer. The survey found the same blocks written by hand in
two or more chains — a per-job declaration record, the entry extension, a
`per` gate, a plan cursor and a continuation marker regexed out of prose,
the no-commit taxonomy restated in prompts, hand-rolled pickability, an
ignore list against engine-owned paths — and five chains that declare
`tests[]` while none runs it. The goal is one interface a consumer adopts,
so that drift and scatter between consumers stop being the normal state.

### Three layers, one dependency direction

- **Kernel** (`src/`) — mechanism only: ticks, worktrees, gates, verdicts,
  pickability, reported facts. Imports nothing. `engine-boundary.md` governs
  it and this section does not loosen that.
- **Chain package** — flume's opinion as a consumable, versioned package
  with typed environment config. Imports the kernel. A consumer declares its
  environment and pins one version; a breaking kernel change is one bump
  plus the package's migration note, not a hand migration.
- **Temper** (a separate project) — types every document in the arena:
  spec, rules, records, prompts, state. Sits beside flume, governs the
  harness's own prose, imports nothing of flume. Only the chain package
  knows both exist, and it knows temper's outputs as files on disk.

Disk is the contract between layers. No tick-time library call into temper
is planned; the persisted rendered prompt is a projection temper can check.

### The chain package's surface

| The package owns | The consumer declares |
| --- | --- |
| The plan slices (inbox, derive, sweep) and build, with their prompts and discipline | Which slices run; the spec locus and how a cite resolves |
| The entry extension — `summary`, `per`, `acceptance`, `tests[]`, `pins[]`, `notes` — and its hints | Extra fields and caps |
| The `tests[]` / `pins[]` judge, behind a runner interface | The test runner: vitest, cargo, dotnet, a script |
| The `per` gate (path **and** section resolve), the records gate, the clean-tree gate, the pending-gate wiring | The gate set per phase and its `when`; extra gates by registry name, inline shell, or script |
| Records as one file each; the plan cursor and continuation marker as declared, typed state, never regexed prose | Writable paths per phase; channel paths; whether writes scope to the entry (the survey argues it both ways, so the package defaults off and documents the tradeoff) |
| A default `handoff` off `pickableAfter` and the reported no-commit facts | Models per phase, extra agent args, tick timeout, parallelism |
| Prompt text that names the engine's no-commit vocabulary once, sourced from the engine | Prompt slots: an autonomy dial, domain context |
| The runtime ignore list, derived from the engine's path record | Nothing |

The per-job declaration record two consumers share — fence, plan fence,
gates, setup dirs, agents per phase, timeout — is the seed of the config
schema.

### Kernel work that precedes it

The package should not carry a workaround the kernel can retire first. Each
is filed as an inbox record: a cost field on agent usage; the entry tag on
the agent invocation; a worktree base that is not an import-time env read;
a base-tree checkout for differential gates; a live-worktree inventory on
the API; the MCP-inheritance question on the agent seam. Already shipped and
awaiting adoption downstream: `pickableAfter`, `readFileAtRef`, and the
latest verdict per phase.

### Adoption

A consumer adds the package, writes one declaration file, and seeds prompts,
protocol, and the state root from it. Upgrading is a version bump plus the
package's migration note. The survey's 0.15.0 column is the last migration
done by hand.

## Decided, not yet executed — quality lenses in the loop

Encode the /simplify review's four angles (reuse, simplification,
efficiency, altitude) into the loop (ruling, 2026-07-31). The socket
already exists: the posture sweep administers the posture pages, so the
missing angles — **reuse** (re-implementation of an existing helper) and
**efficiency** (wasted work per tick/wave) — enter as new sections of
`.claude/rules/engineering.md`; altitude and simplification are already
covered by engine-boundary and complexity-is-a-signal. A phrase delta
then arms a full-domain rotation and the loop gains the behavior with
zero engine or chain change.

Open design half: the correctness-adjacency filing bar (same-day ruling)
demotes exactly the findings these lenses produce. Resolve before
arming — either a quality lane (pure-shape debt accumulates in commit
bodies, batched into a dedicated quality wave at release cuts) or a bar
carve-out for reuse findings that retire real drift risk. Sequencing: the
lenses arm the tick that fork is ruled, and not before — no release line
gates them, and a ruling is the observable condition a later reader can
check.

## Beyond v0.1 — dependency-aware fanout

Fanout intelligence stays partition-level, not orchestration-level. Today entries fan out disjoint-by-`Files:` — pure conflict-avoidance, with no notion of "entry B consumes entry A's output." The Pending schema already carries `blockedBy`/`deferred`; the next step is for the partitioner and dispatcher to *schedule waves by declared dependency*, not just file-disjointness — dependent entries serialize, independent ones still parallelize.

This deliberately borrows the *idea* behind agent-team task graphs, not the mechanism. Agent teams coordinate through persistent sessions, an inter-agent mailbox, and by-user runtime state under `~/.claude/` — the negation of stateless ticks, disk-is-truth, and JSON handoff. Flume takes the dependency-ordering benefit from a smarter *stateless* partition pass over disk-rooted Pending entries; it does not adopt durable teammate sessions or hidden coordination state. A reviewer phase that bounces entries back to Pending via an `afterMerge` gate is the in-posture analog of team review — same effect, expressed as JSON on disk.
