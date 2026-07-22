# Inbox — findings queue

Transient queue of findings awaiting triage by the plan phase. Append-only by external reviewers; drained-only by plan.

## Who writes here

- Humans dropping observations to be routed.
- Future review skills (e.g. multidim-review, security-review) when added.

**Plan does not write here.** Plan-tick self-audit findings go directly to `.flume/plan/pending.json` (file as entry), to `.flume/plan/open-questions.md` (parked for human input), or live only in the `plan:` commit message body (narrative + dispositions).

## Who reads here

The plan phase reads inbox.md every tick and drains each entry into one of three outcomes:

1. **File as a pending entry** in `.flume/plan/pending.json` (with a `per` cite to the relevant spec section).
2. **Park** in `.flume/plan/open-questions.md` if it needs human input before any code can land.
3. **Accept as debt** — note the disposition + one-line reason in the `plan:` commit message body.

After routing, the inbox entry is **removed**. The queue is meant to drain; it is not a log. Narrative history lives in git.

## Format

Each entry is a markdown subsection:

```
## YYYY-MM-DD — <short label> (<source>)

<finding body — observations, file:line cites, severity if known>
```

`<source>` is the writer (e.g. `human`, `multidim-review`). One subsection per finding cluster; group related items under one `##` to keep routing atomic.

---

<!-- entries below this line; newest first -->

## 2026-07-22 — per-phase agent/model assignment (human, via flume-dock)

The plan/build norm encodes a model cascade — a stronger model derives
work, a cheaper model executes it (empirically validated by aider's
architect/editor split) — but there is no seam: one Agent instance serves
every phase (src/cli.ts:236 wires a single `claudeCode()`; Phase carries
no agent/model field, src/Phase.ts). Ask: a per-phase override
(`Phase.agent?: Agent`, or `model?: string` flowing to `--model` in the
claudeCode argv), resolved as phase override ?? harness default. First
consumer: flume-dock's sweep preset wants plan on a mid-tier model and
build on a cheap one.

## 2026-07-22 — fanout write scope derived from the assigned entry (human, via flume-dock)

`writablePaths` is a static phase-wide union (src/Phase.ts:98), but the
scope dictation already lives per-entry: `files.new/edit/retire`
(src/PendingSchema.ts:97) is what the fanout partition reads. Ask: for a
fanout tick with an assignedEntry, the post-commit write guard scopes to
the entry's declared paths plus an explicit channel allowance (e.g. a
friction/intake file), with the phase globs as the outer ceiling. Plan
dictates "here is the objective, here are the files"; the mechanism
enforces exactly the atom it assigned. Convergent with how Spec Kit tasks
carry exact file paths and BMAD stories carry their own scope.
