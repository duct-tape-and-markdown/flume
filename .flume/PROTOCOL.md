# Flume Protocol — project conventions

Runtime mechanics (baton, gates, handoff, pending schema) live in the local `flume` runtime (`src/`, this repo *is* flume); the harness that runs it — slices, prompts, judges, gates, records, plan state — is the harness package (`harness/`, `spec/harness.md`), applied to this repo's `.flume/declaration.ts` by `.flume/chain.ts`.

## The chain

`spec/*.md` → `.flume/plan/` → `src/` (+ `tests/`, `docs/`, etc.) → git log

Build re-validates each entry against the cited section (in the file its `per.path` names) before acting. The commit body says what kind of work the tick did — typically a sentence on the why. Harness-authored commits use `chore(flume):` (e.g. `chore(flume): ship TAG`).

## What an entry carries

An entry is a contract between two ticks that never meet: plan writes it, a fresh
build process reads it with no shared memory and no access to the reasoning that
produced it. **Plan states the contract; build chooses the implementation.** That
line decides whether a field belongs.

Three consumers, and only three:

- **The engine** reads `tag` (identity — commit token, worktree dir, ship record,
  uniqueness), `gate` (pickable now), `dependsOnForks` (foundation settled), and
  `files` (the fanout partition's disjointness input, and nothing else).
  Nothing else in an entry is engine business.
- **The build tick** reads what a fresh context cannot derive from the repo:
  `summary` (what), `per` (why, and on whose authority — the repo shows what the
  code *is*, never what it should *become*), `acceptance` (what done means,
  decidably), `tests[]` (acceptance decomposed, one line per behavior the work
  must pin, written as a test title — build titles a passing test with the
  line and the `vitest` gate proves it, then proves it **red on the base**:
  the named test is run against the pre-fix tree and a line that already
  passes there is refused; the file it lands in is build's call), and
  `pins[]` (a property that already holds and gains its check in this entry
  — an agreement pin, a doc-to-source scan — same title discipline, judged
  green only). Plan chooses the list; a `tests[]` line the gate finds green
  on the base wakes plan to move it, since build cannot.
- **The next plan tick** reads `observedFiles` — dispatcher-written, the real
  footprint of a reverted attempt.

An entry does **not** carry where build may write (`files` is a prediction for the
scheduler, never a permission and never a fence — build's `writablePaths` in
`.flume/chain.ts` is the whole containment), how to implement, which file a test
lands in, or its own history (prior attempts arrive in the engine's
`<prior-attempt>` block). Each of those is one lane prescribing inside another's.
Plan states the architecture; where the edits fall is build's call.

## What makes an entry good, not merely valid

No schema holds these; they are the plan tick's actual work.

1. **One tick's work.** If it cannot land as one commit with green gates it is two
   entries, a spec section, or a decision nobody has made.
2. **Independently shippable.** Its gates pass on its own; dependence on a sibling
   is `blockedBy`, declared, never assumed by queue order.
3. **Cited, not invented.** `per` resolves to a section that justifies *this* work — that it resolves at all is gated (`per cites resolve`, `.flume/chain.ts`); that it justifies the work is plan's judgment.
   An entry that cannot carry a clean cite is an open question.
4. **Acceptance is decidable.** Someone who did not write it runs it and gets yes
   or no. "Improve error handling" is not acceptance.
5. **Footprint honest.** `files` names what the work will touch — not everything it
   might, not everything nearby. Over-declaring costs wave width; under-declaring
   costs at most a cherry-pick conflict, which the dispatcher aborts and retries.
6. **Contract couplings are ordered, not assumed.** An entry that changes a
   supervisor↔child contract (claim inheritance, verdict paths, exit codes) is
   `blockedBy` the entry that completes the contract's other half, because a live
   supervisor runs the pre-change half until the run ends (`spec/loop.md`, *A run
   finishes on the contract it started with*). Shipping the refusal semantics
   before the inheritance mechanism livelocked a live loop (2026-08-17).

## Plan slices

Plan is three singleton phases, one job each — `plan-inbox`, `plan-derive`, `plan-sweep` — in that priority. Each owns one cursor in the plan state (`plan/state.json`, typed fields the package reads through its own accessor — `spec/harness.md`, *Plan state as declared state*, names them); the windows a slice reads, the predicates and the ladder, and the shared writer discipline are the package's — the slice prompts point at the discipline page by the address the package resolves.

## Records: one file each

A finding for plan and a note from build are **records**: one file per record, never a section appended to a shared document. Git merges by line position, so two ticks appending to one file conflict whatever the syntax; two ticks creating two files never do, and the fence can name a file where it cannot name a section.

- **Inbox** — `.flume/inbox/<YYYY-MM-DD>-<slug>.md`, written by whoever observes something in the field (a human, a review skill). First line `# <title> (<source>)`.
- **Build notes** — `.flume/plan/notes/<TAG>.md`, written by the build tick assigned that entry and no other. First line `# <title>`. One file carries either an observation the next plan tick should know, or a **park**: a commit whose only path is the entry's note is the signal that the entry cannot ship as written — its premise is contradicted by the tree, it needs a decision nobody made, or the work is already there — and `build.shipped` keeps it in the queue. A park is never about paths: there is no per-entry fence to fall outside.
- **Open questions** stay one file, `.flume/plan/open-questions.md`, because plan is its only writer and plan is a singleton.

**A record is short.** It says what was observed, where (a path and line, or a sha), and why it matters — at most **1,200 bytes**, measured as bytes (`wc -c`), not characters: an em-dash is three. Options appear only when a decision genuinely forks, one line each. What a record does not carry: the reasoning that led to it, restated spec, or a proposed patch; the reader re-verifies against the tree regardless. The `records` gate refuses a commit that writes a record without a title line, under a tag that is not the tick's own, or from a plan slice — plan **drains** records and never creates one. A record over the cap is not refused: it ships with its entry, and the drain names the overrun in the plan commit body.

Drained means **deleted**: the inbox slice routes each record to an entry, an open question, or an accepted-debt line in its commit body, then removes the file. An empty directory is the steady state.

## Disk vs git log

When asking "did X ship?" or "is gate Y satisfied?" — read the disk artifact (`.flume/plan/pending.json`, the source file). Never grep commit messages or `git log`. Git log is orientation, not authority.

## Push policy

- Build pushes per commit to `main` after green validation; plan commits don't push — they ride the next build push.
- Force-push, amend, and `--no-verify` prohibitions: CLAUDE.md Non-Negotiables.

## Where runtime lives

- Inter-phase contracts: the harness package's chain factory (`harness/`), applied by `.flume/chain.ts`. Per-phase prompts: the package's (`harness/prompts/`). Runtime: `src/` (this repo).
- CLI: `pnpm flume` (runs `src/cli.ts` under tsx) — `flume --help` is the authority for subcommands.
