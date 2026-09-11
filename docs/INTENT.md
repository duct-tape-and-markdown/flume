# Flume — Intent

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
carve-out for reuse findings that retire real drift risk. Sequencing:
arm after the v0.11 boundary line ships, so the lenses don't polish code
the demolition deletes.

## Beyond v0.1 — dependency-aware fanout

Fanout intelligence stays partition-level, not orchestration-level. Today entries fan out disjoint-by-`Files:` — pure conflict-avoidance, with no notion of "entry B consumes entry A's output." The Pending schema already carries `blockedBy`/`deferred`; the next step is for the partitioner and dispatcher to *schedule waves by declared dependency*, not just file-disjointness — dependent entries serialize, independent ones still parallelize.

This deliberately borrows the *idea* behind agent-team task graphs, not the mechanism. Agent teams coordinate through persistent sessions, an inter-agent mailbox, and by-user runtime state under `~/.claude/` — the negation of stateless ticks, disk-is-truth, and JSON handoff. Flume takes the dependency-ordering benefit from a smarter *stateless* partition pass over disk-rooted Pending entries; it does not adopt durable teammate sessions or hidden coordination state. A reviewer phase that bounces entries back to Pending via an `afterMerge` gate is the in-posture analog of team review — same effect, expressed as JSON on disk.
