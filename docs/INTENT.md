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
