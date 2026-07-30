# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## STALE-GLOBAL-FLUME-LOOP — live loop/tick processes execute a stale published package, not this repo's src

**PARKED — urgent: actively corrupting data every ship, right now**

Context: root-caused why `SHIP-PENDING-CLOBBER-BUG` recurred immediately after its own fix shipped. `6203ee5` fixed `commitPendingUpdate` to re-read `pending.json` fresh from disk; the very next commit, `38ea981` (`chore(flume): ship SHIP-PENDING-CLOBBER-BUG`), reintroduced the retired `schemaDelta` field into the 2 untouched entries — the identical corruption, one commit later. Checked live: `pnpm exec which flume` resolves to a **globally npm-installed** `@dtmd/flume@0.5.0` (`~/.nvm/.../lib/node_modules/@dtmd/flume`, `dist/` built 2026-07-30 09:30 — before today's fix landed), not this repo's own build. That global `dist/Dispatcher.js` still has the exact pre-fix signature, `commitPendingUpdate(before, shippedTags, observed)` — a stale snapshot, no fresh re-read. `.flume/loop.pid`'s processes (confirmed via `ps`: loop PIDs 307306/307326/307344, tick PID 385416) are that global binary. Every `chore(flume): ship` commit executes pre-fix code no matter what lands in `src/Dispatcher.ts` — the fix is correct but inert until the running process is the local build. Published npm latest is 0.6.2 (matches local `package.json`), so even the global install is stale against the registry, let alone against trunk's unpublished HEAD.

Options:
1. **Stop the stale loop now; restart pointed at local (recommended).** Kill the current loop/tick processes; invoke via this repo's own `bin/flume.js` (package.json already has a `"flume"` script pointing there) instead of relying on `pnpm exec flume`, which falls through to whatever `flume` is on `$PATH`. Closes the active-corruption window immediately.
2. **`npm install -g @dtmd/flume@latest`.** Only brings the global install to 0.6.2 — still not trunk's unpublished HEAD, so still not guaranteed current with in-flight `src/` fixes. Stopgap at best.
3. **Leave as-is.** Not viable — `pending.json` will keep corrupting on every ship, and no `src/` fix can close the gap since the fix is never executed.

Recommendation: option 1, a human action (process control + global npm state, outside plan's writable paths). Confirmed still active this tick: `119a4f1` (`chore(flume): ship PENDING-GATE-BUILTIN`) reintroduced `schemaDelta` into the untouched `SECOND-REFERENCE-CHAIN` entry — identical corruption, one ship-cycle later. Repaired again (stripped); expect recurrence on every future ship until the loop is repointed.

## PENDING-GATE-DOGFOOD-ADOPTION — chain.ts still hand-rolls pendingParseGate; v0.8 §6 acceptance not fully closed

**PARKED**

Context: `PENDING-GATE-BUILTIN` shipped `pendingGate` (`src/builtinGates.ts`) per v0.8 §6, but the entry's own notes carved dogfood adoption out as an "operator leg." `.flume/chain.ts`'s `plan.gates` (line 189) still wires the hand-rolled `pendingParseGate` (lines 94-122) instead of the new builtin. `chain.ts` sits outside both phases' `writablePaths` (plan: `.flume/plan/*`, `.flume/inbox.md`; build: `src/`,`tests/`,`docs/`, etc — no `.flume/*`), so neither phase can make this swap itself. §6's acceptance line — "dogfood runs the builtin with its extension schema enforced" — remains open.

Options:
1. **Direct operator commit (recommended).** Replace `pendingParseGate` in `plan.gates` with `pendingGate({ extension: entryExtension, targetFence: build })`, delete the now-dead hand-rolled gate — same class as `PROMPTS-BUILD-FENCE-INSTRUCTION`'s direct `chore(flume):` commit.
2. **Leave as-is.** §6 stays "shipped but unproven" — the builtin exists but nothing dogfoods it, against the spec's own stated proof requirement.

Recommendation: option 1, a small mechanical `chore(flume):` commit, outside any phase's fence by design.

## BUILD-PARK-COMMIT-BEFORE-BAIL — voluntary-bail park notes die with the worktree

**PARKED**

Context: v0.7 §13 established that when build's fence conflicts with the work, the tick parks a note in `open-questions.md` and bails rather than committing into a guaranteed revert — that instruction itself lives in `prompts/build.md`, applied by operator commit (`PROMPTS-BUILD-FENCE-INSTRUCTION`, closed `db645f5`) since prompts sit outside every phase's fence. §15 (shipped `c8ccfd2`) made plan wake on a voluntary-bail, but the park note is written inside the fanout worktree and never committed — worktree cleanup at wave end destroys it, so plan wakes with zero visibility into why. Observed live: the PENDING-SCHEMA-CORE-EXTENSION-SPLIT wave bailed with an uncommitted park, reconstructable only from the session log.

Options:
1. **Prompt fix (recommended).** `prompts/build.md` instructs: when parking a note and bailing, commit that single-file `open-questions.md` edit before exiting (already within build's write allowance for that path) instead of leaving an uncommitted worktree diff. No new engine mechanism — same shape as the already-shipped §13/§15 operator legs.
2. **Engine salvage.** Dispatcher detects channel-path edits in a worktree on voluntary-bail and lands them as a park commit itself. More machinery than the gap needs; `.claude/rules/collaboration.md`'s complexity-is-a-signal rule favors option 1 unless prompt-level discipline can't be trusted to fire every time.

Recommendation: option 1, applied directly to `prompts/build.md` via `chore(flume):` commit — no pending entry, same class as `PROMPTS-BUILD-FENCE-INSTRUCTION`.
