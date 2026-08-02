# Flume Protocol — project conventions

Runtime mechanics (baton, gates, handoff, pending schema) live in `.flume/chain.ts` and the local `flume` runtime (this repo *is* flume — chain.ts imports from `../src/`). This file holds project-side conventions the chain config doesn't encode. Layer lanes, authorship, and commit prefixes: `.claude/rules/spec-plan-build.md`.

## The chain

`spec/RELEASE-*.md` → `.flume/plan/` → `src/` (+ `tests/`, `docs/`, etc.) → git log

Build re-validates each entry against the cited section (in the file its `per.path` names) before acting. The commit body says what kind of work the tick did — typically a sentence on the why. Harness-authored commits use `chore(flume):` (e.g. `chore(flume): ship TAG`).

## Plan continuation marker

Plan ticks process the *delta* since the last tick that did the work — each dimension windowed by its own stamp in `state.md` (`Audited through:`, `Spec derived through:`, `Posture swept through:`), never by a `git log` grep, so a sliced dimension keeps its remainder. When the delta overflows what one tick can do well, plan writes `Plan continues: yes — <one-line reason>` into `state.md` and the harness re-wakes plan; `Plan continues: no` (or absence) hands to build (if pickable entries exist) or hibernates. The exact load-bearing predicate lives in `.flume/chain.ts` `plan.handoff`; the writer-side mandate in `.flume/prompts/plan.md`.

## Disk vs git log

When asking "did X ship?" or "is gate Y satisfied?" — read the disk artifact (`.flume/plan/pending.json`, the source file). Never grep commit messages or `git log`. Git log is orientation, not authority.

## Push policy

- Build pushes per commit to `main` after green validation; plan commits don't push — they ride the next build push.
- Force-push, amend, and `--no-verify` prohibitions: CLAUDE.md Non-Negotiables.

## Where runtime lives

- Inter-phase contracts: `.flume/chain.ts`. Per-phase prompts: `.flume/prompts/{plan,build}.md`. Runtime: `src/` (this repo).
- CLI: `pnpm exec flume` — `flume --help` is the authority for subcommands.
