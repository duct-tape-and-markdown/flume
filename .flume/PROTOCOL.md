# Flume Protocol — project conventions

Runtime mechanics (baton, gates, handoff, pending schema) live in `.flume/chain.ts` and the local `flume` runtime (this repo *is* flume — chain.ts imports from `../src/`). This file holds project-side conventions the chain config doesn't encode. Layer lanes, authorship, and commit prefixes: `.claude/rules/spec-plan-build.md`.

## The chain

`spec/RELEASE-*.md` → `.flume/plan/` → `src/` (+ `tests/`, `docs/`, etc.) → git log

Build re-validates each entry against the cited section (in the file its `per.path` names) before acting. The commit body says what kind of work the tick did — typically a sentence on the why. Harness-authored commits use `chore(flume):` (e.g. `chore(flume): ship TAG`).

## What an entry carries

An entry is a contract between two ticks that never meet: plan writes it, a fresh
build process reads it with no shared memory and no access to the reasoning that
produced it. **Plan states the contract; build chooses the implementation.** That
line decides whether a field belongs.

Three consumers, and only three:

- **The engine** reads `tag` (identity — commit token, worktree dir, ship record,
  uniqueness), `gate` (pickable now), `dependsOnForks` (foundation settled), and
  `files` (the fanout partition's disjointness input, and the ship predicate's).
  Nothing else in an entry is engine business.
- **The build tick** reads what a fresh context cannot derive from the repo:
  `summary` (what), `per` (why, and on whose authority — the repo shows what the
  code *is*, never what it should *become*), `acceptance` (what done means,
  decidably), `tests[]` (acceptance decomposed, one line per behavior the work
  must pin — the behavior only; the file it lands in is build's call).
- **The next plan tick** reads `observedFiles` — dispatcher-written, the real
  footprint of a reverted attempt.

An entry does **not** carry where build may write (`files` is a prediction for the
scheduler, never a permission), how to implement, which file a test lands in, or
its own history (prior attempts arrive in the engine's `<prior-attempt>` block).
Each of those is one lane prescribing inside another's.

## What makes an entry good, not merely valid

No schema holds these; they are the plan tick's actual work.

1. **One tick's work.** If it cannot land as one commit with green gates it is two
   entries, a spec section, or a decision nobody has made.
2. **Independently shippable.** Its gates pass on its own; dependence on a sibling
   is `blockedBy`, declared, never assumed by queue order.
3. **Cited, not invented.** `per` resolves to a section that justifies *this* work.
   An entry that cannot carry a clean cite is an open question.
4. **Acceptance is decidable.** Someone who did not write it runs it and gets yes
   or no. "Improve error handling" is not acceptance.
5. **Footprint honest.** `files` names what the work will touch — not everything it
   might, not everything nearby. Over-declaring costs wave width; under-declaring
   costs at most a cherry-pick conflict, which the dispatcher aborts and retries.

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
