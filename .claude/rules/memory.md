# Memory

**All project context lives in this repo. Auto-memory is disabled (`autoMemoryEnabled: false` in `.claude/settings.json`).**

## Why

Flume ticks run autonomously via `claude -p`. Each iteration is a fresh process. Invisible memory saved at `~/.claude/projects/.../memory/` is by-user, not by-project, and the loops have no special access to it. If knowledge isn't in the repo, the agent re-discovers it every iteration and the user can't see what's accumulating.

## What lives in the repo

| What                                            | Where                       |
| ----------------------------------------------- | --------------------------- |
| Project posture, non-negotiables, pointers      | `CLAUDE.md`                 |
| Operational rules (collaboration, memory, ...)  | `.claude/rules/*.md`        |
| Inter-phase project conventions                 | `.flume/PROTOCOL.md`        |
| Flume chain config (writable paths, gates, ...) | `.flume/chain.ts`           |
| Per-phase prompts                               | `.flume/prompts/*.md`       |
| Active plan + scratch state                     | `.flume/plan/*`             |
| Findings inbox (transient queue)                | `.flume/inbox.md`           |
| Ship-readiness target                           | `spec/RELEASE-v0.1.md`      |
| Longer-range design intent                      | `docs/INTENT.md`            |

The `.flume/plan/open-questions.md` file doubles as cross-tick scratch space — when a build tick learns something the next plan tick should know about (debt observed, surprising pattern, blocker), it writes that there.

## Don't

- Don't write to `~/.claude/projects/.../memory/`.
- Don't read from there expecting context — none should exist; if any does, it's stale.
- Don't fall back to auto-memory "just in case." Add a file under `.claude/rules/`, capture in `spec/RELEASE-v0.1.md` (human-edited), or note in `.flume/plan/open-questions.md` instead.
