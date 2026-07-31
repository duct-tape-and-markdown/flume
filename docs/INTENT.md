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
- **Provenance.** Inter-layer references (workshop → spec → plan → code) are typed citations the harness can verify.

### The commit is the transaction

A tick's commit is the atomic unit of work, and `git reset --hard` is the only rollback primitive. This is why **pipeline state — `pending.json`, plan prose — is committed on purpose, not as bookkeeping**: committing it is what makes a gate-revert atomic (a malformed `pending.json` is reverted by the same machinery that reverts bad code) and what makes a half-finished tick recoverable (the prior commit is intact). The plan phase's whole reliability rests on this.

A consequence for anything built on flume: a layer that wants *ephemeral* pipeline state (run, then leave no trace) cannot get there by **un**committing — that deletes the transaction the plan phase depends on. It gets there by **disposing of the commits**: confine them to a throwaway branch/ref and extract only the real deliverable at teardown. Disposable ≠ uncommitted. Where the committed state *lives* is relocatable (`flumeDir`); *that* it is committed is not.

## What stays prose

Specs, workshop notes, ADRs, READMEs, plan-State summaries, open-questions lists. These are documentation surfaces for humans and prose-aware agents. Markdown is correct here.

## What becomes JSON

Anything the dispatcher mechanically consumes — Pending entries, gate results, ledger snapshots, phase handoff signals. One schema, four enforcement points (parse, validate, prompt-inject, type-input). No handrolled parsers.

## Non-goals

- **Session continuity.** Reintroduces in-memory state the protocol exiles. Every tick is fresh.
- **In-agent iteration.** A tick is one invocation. The dispatcher decides re-runs.
- **Hardcoded chain.** Workshop → specs → plan → code is the default, not the framework.
- **Multi-provider agent abstraction (v0).** Claude-only via `claude -p`, single named seam for later swap.

## v0 success criterion

From a fresh clone of a Flume-driven repo, replacing `bin/flume-bash` with `npx flume` produces the same sequence of commits the prior harness would have produced — *and* prompts have shrunk because validation has moved into harness-enforced gates.

## Parallelism

Built-in from v0 via git worktree fanout for phases declared `concurrency: "fanout"`. Disjoint-by-`Files:` Pending entries fan out into per-entry worktrees, each runs its agent invocation + gates in isolation, then merges into the trunk in commit order with a post-merge gate. No Docker required; worktrees are the isolation primitive.

Docker is a v1 layer for AFK / env reproducibility / capability isolation, behind the same `SandboxProvider` seam.

## Decided, not yet executed — spec corpus reform

The per-release spec segmentation (`spec/RELEASE-*.md`, frozen once
shipped) is to be replaced with a **living, domain-partitioned spec**
(e.g. `spec/tick.md`, `spec/cli.md`, `spec/jobs.md`) that always states
current truth, edited in place under operator direction (ruling,
2026-07-31). The release files conflate three roles — current truth,
ship-target delta, record of rulings — and only the first is unowned
elsewhere: plan's delta detection is already a git diff over `spec/`
(layout-agnostic), and the record already lives in git history +
CHANGELOG. The supersedes-chain tax compounds per release and is the
complexity signal. Ruling-of-record moves to the spec commit; release
boundaries move to CHANGELOG + tags (or a minimal target note). Touches
only convention surface: plan prompt hints, chain.ts comments,
CLAUDE.md pointer — zero engine. Sequencing: execute after the current
release lines (0.10 sighted-render, 0.11 boundary line) are underway or
shipped; the consolidation is human-surface work done in-session.

## Beyond v0.1 — dependency-aware fanout

Fanout intelligence stays partition-level, not orchestration-level. Today entries fan out disjoint-by-`Files:` — pure conflict-avoidance, with no notion of "entry B consumes entry A's output." The Pending schema already carries `blockedBy`/`deferred`; the next step is for the partitioner and dispatcher to *schedule waves by declared dependency*, not just file-disjointness — dependent entries serialize, independent ones still parallelize.

This deliberately borrows the *idea* behind agent-team task graphs, not the mechanism. Agent teams coordinate through persistent sessions, an inter-agent mailbox, and by-user runtime state under `~/.claude/` — the negation of stateless ticks, disk-is-truth, and JSON handoff. Flume takes the dependency-ordering benefit from a smarter *stateless* partition pass over disk-rooted Pending entries; it does not adopt durable teammate sessions or hidden coordination state. A reviewer phase that bounces entries back to Pending via an `afterMerge` gate is the in-posture analog of team review — same effect, expressed as JSON on disk.
