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
- **Provenance.** The extension point, not the citation. A chain declares its own pending-entry fields (`Chain.entryExtension`, one declaration driving both the validator and the prompt hint); the engine runs the validator it was handed and never reads what the field means. The harness package spends that point on `per` — a `{ path, section }` cite — and enforces it with the `per cites resolve` gate, which checks the path matches the consumer's declared `specLocus` (this repo: `spec/`, `.claude/rules/`), is present in the gated commit, and heads exactly one section there. Inter-layer citation discipline is a chain's to define and gate; the harness ships the seam that lets it.

### Committed state is the loop's memory

Each tick reads the disk, does work, and commits. The next tick starts from what the last one left, and that accumulation **is** the mechanism: a chain converges by iterating against committed state, not by any single tick being correct. This is why **pipeline state — the pending queue, plan prose — is committed on purpose, not as bookkeeping**: it is what the next iteration reads.

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

## Shipped — the consumable chain

Ruled 2026-09-14 on the consumer chain survey
(`docs/surveys/consumer-chains/`, five consumers read against 0.15.0), and
shipped: the harness package is `harness/` in this repository, published as
the `./harness` subpath of `@dtmd/flume`, adopted with `flume-harness init`,
and contracted by `spec/harness.md`. This repo's own `.flume/` is its first
consumer — `chain.ts` is the package's factory applied to
`.flume/declaration.ts`, and nothing else.

What the survey found, and what the package answers: the engine shipped as a
package while the harness that ran it did not, so every consumer re-authored
it and every breaking engine change cost one hand migration per consumer. The
same blocks were written by hand in two or more chains — a per-job declaration
record, the entry extension, a `per` gate, a plan cursor and a continuation
marker regexed out of prose, the no-commit taxonomy restated in prompts,
hand-rolled pickability, an ignore list against engine-owned paths — and five
chains declared `tests[]` while none ran it. One interface a consumer adopts
is how drift and scatter between consumers stop being the normal state.

### Three layers, one dependency direction

- **Kernel** (`src/`) — mechanism only: ticks, worktrees, gates, verdicts,
  pickability, reported facts. Imports nothing. `engine-boundary.md` governs
  it and this section does not loosen that.
- **Chain package** (`harness/`, shipped as `@dtmd/flume/harness`) — flume's
  opinion as a consumable, versioned with the kernel it imports. A consumer
  declares its environment in one module and pins one version; a breaking
  kernel change is one bump plus the package's migration note, not a hand
  migration.
- **Temper** (a separate project, outside this repository) — types every
  document in the arena: spec, rules, records, prompts, state. Sits beside
  flume, governs the harness's own prose, imports nothing of flume. Only the
  chain package knows both exist, and it knows temper's outputs as files on
  disk.

Disk is the contract between layers. No tick-time library call into temper
is planned; the persisted rendered prompt is a projection temper can check.

### The chain package's surface

The split the ruling drew — the package owns the slices, prompts, entry
extension, judge, discipline gates, records, plan state, default `handoff`
and runtime ignore set; the consumer declares its spec locus and cite
resolution, its fence and channel paths, its test runner, its extra gates and
agents, and its prompt slots — is now the package's contract rather than an
intent. `spec/harness.md`, *What the package owns* and *What a consumer
declares*, states it; this page does not keep a second copy.

The one place the ruling deliberately took no side survives as a default:
`scopeWritesToEntry` is off, because the survey argues it both ways, and the
package documents the tradeoff instead of choosing.

### Kernel work that preceded it

The package was not to carry a workaround the kernel could retire first, so
each was filed as an inbox record and shipped before adoption: a cost field on
agent usage, the entry tag on the agent invocation, a worktree base that is
not an import-time env read (`Chain.worktreesBase`), a base-tree checkout for
differential gates and a live-worktree inventory on the API (`checkoutAt`,
`readWorktreeRegistry`), and the MCP-inheritance knob on the agent seam
(`inheritUserMcp`, off by default). `pickableAfter`, `readFileAtRef` and the
latest verdict per phase were already shipped and are now adopted. Nothing on
that list is outstanding.

### Adoption

`flume-harness init` writes the declaration skeleton, the `chain.ts` that
applies the factory to it, the state root with an empty queue, the ignore
lines and `PROTOCOL.md`, and declares the dependency. Upgrading is a version
bump plus the release's migration note. The survey's 0.15.0 column is the last
migration done by hand.

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
