# Flume

## Identity

- Project: Flume — a disciplined harness for AI-derivation pipelines. Disk-is-truth, stateless ticks, structured handoff. Each tick is one phase × one agent invocation = one commit (or zero). The harness enforces output shape, capability scoping, validation gates, and baton mechanics; prompts say what the agent produces, not what discipline to remember.

## Source of truth

**Read the spec corpus first** — `spec/RELEASE-*.md`. Each file is one release line's ship target: what must ship, the public API surface, tests, docs. The newest is the active plan target; earlier lines are frozen once shipped. Plan derives against whatever changed in `spec/` since the last `plan:` commit. `docs/INTENT.md` carries the longer-range design intent; historical material lives in `docs/`.

This is flume operating on flume: `.flume/chain.ts` imports the runtime from `../src/` (this repo), not from `flume/` (a published dep). Breaking runtime changes must update chain.ts in the same commit.

## Tech Stack

- Node 22, TypeScript (strict, `exactOptionalPropertyTypes`), pnpm
- Test: vitest
- Runtime deps: `tsx` (loads chain.ts), `zod` (PendingSchema validation)

Stack-specific conventions belong in `.claude/rules/<area>.md` and should be path-scoped where possible.

## Workflow: Flume

Two autonomous phases (plan, build) sharing one TypeScript dispatcher. Chain config in `.flume/chain.ts`; per-phase prompts in `.flume/prompts/{plan,build}.md`. Runtime is local (`src/`, not a pnpm dep). Run via `pnpm exec flume` (subcommands: `tick`, `loop`, `status`, `wake`, `sleep`, `render`). Plan output is structured JSON at `.flume/plan/pending.json`; prose at `.flume/plan/{state,open-questions}.md`. State on disk; each tick is a fresh `claude -p`. Loops are autonomous — no slash command invokes them.

Project conventions for the chain live in `.flume/PROTOCOL.md`.

**Pushback is the point.** Never silently fill product/UX gaps — challenge them. See @.claude/rules/collaboration.md.

## Common Commands

- `pnpm tsc --noEmit` — typecheck
- `pnpm test` — vitest
- `pnpm exec flume status` — baton state
- `pnpm exec flume tick` — one tick of whichever phase is awake
- `pnpm exec flume loop` — autonomous loop until hibernation

## Quality Standard

Engineering: **Safe**, **Fast**, **Reliable.** Chain-config gates (tsc, vitest, writable-paths, pending-parse) validate each tick. Product/UX pressure-test is human.

## Non-Negotiables

- Build phase commits per pending entry directly to `main` after green validation.
- NEVER force-push, amend pushed commits, or `--no-verify`.
- NEVER modify files when asked to investigate — investigate and report.
- Search the codebase before implementing — don't assume not implemented.
- Never silently fill a gap in a spec — challenge it.
