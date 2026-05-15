# Flume Protocol — project conventions

Runtime mechanics (baton, gates, handoff, pending schema) live in `.flume/chain.ts` and the local `flume` runtime (this repo *is* flume — chain.ts imports from `../src/`). This file holds project-side conventions the chain config doesn't encode.

## The chain

`spec/RELEASE-v0.1.md` → `.flume/plan/` → `src/` (+ `tests/`, `docs/`, etc.) → git log

`spec/RELEASE-v0.1.md` is the human-curated ship-readiness target for the v0.1 public release. Plan derives the work breakdown against it; build executes one entry at a time. Plan is advisory to build (build re-validates against the cited section before acting).

| Layer | Author | Phase | Commit prefix |
| ----- | ------ | ----- | ------------- |
| spec  | human  | —     | (any)         |
| plan  | plan   | plan  | `plan:`       |
| code  | build  | build | `build:`      |

The commit body says what kind of work the tick did. Typically a sentence on the why.

Harness-authored commits use `chore(flume):` (e.g. `chore(flume): ship TAG`).

## Plan continuation marker

Plan ticks process the *delta* between this tick and the last `plan:` commit (commits since, spec diff since, current pending/inbox/state). When the delta overflows what plan can do well in one tick, the agent signals continuation via a line in `state.md`:

- `Plan continues: yes — <one-line reason>` → harness re-wakes plan on the next tick.
- `Plan continues: no` (or absence) → harness hands to build (if pickable entries exist) or hibernates.

The contract: any line in `state.md` matching `/^Plan continues:\s*yes\b/im` triggers re-wake. Convention is to put it as the final line; the regex doesn't require that. Plan owns `state.md`; this line is **load-bearing** — the harness's plan-handoff in `.flume/chain.ts` reads it synchronously to decide who wakes next.

## Disk vs git log

When asking "did X ship?" or "is gate Y satisfied?" — read the disk artifact (`.flume/plan/pending.json`, the source file). Never grep commit messages or `git log`. Git log is orientation, not authority.

## Push policy

- Build pushes per commit to `main` after green validation (the chain config's gates are the bar).
- Plan commits don't push; they ride the next build push.
- Never force-push, amend pushed commits, or `--no-verify`.

## Where runtime lives

- Inter-phase contracts (baton, gates, writable paths, handoff): `.flume/chain.ts` (this repo).
- Flume runtime (pending schema, dispatcher, fanout, worktree setup, cherry-pick): `src/` in this repo. chain.ts imports from `../src/` rather than `flume/src/` because the dogfood subject *is* the runtime.
- Per-phase prompts: `.flume/prompts/{plan,build}.md` (this repo).
- CLI: `pnpm exec flume <subcommand>` (`tick`, `loop`, `status`, `wake`, `sleep`, `render`).
