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

Recommendation: option 1, a human action (process control + global npm state, outside plan's writable paths). Confirmed still active this tick, directly: this plan session's own process tree resolves to the stale global loop — `.flume/loop.pid` → pid 307344 (`.../lib/node_modules/@dtmd/flume/dist/cli.js loop`) → child 439347 (`... cli.js tick`) → child 439428, the `claude -p ... --model sonnet` process running this very tick. The SECOND-REFERENCE-CHAIN ship (`546d572`) happened not to reintroduce `schemaDelta` this cycle only because its pending.json edit emptied the array outright (nothing partial to corrupt) — the stale code path is still live and will corrupt the next partial edit.

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

## CONSUMER-SMOKE-PIN-HANDSHAKE-BREAK — existing "Consumer-install smoke" CI step likely broken by the v0.7 §10 engine↔pin handshake

**PARKED**

Context: found while building `SECOND-REFERENCE-CHAIN`'s own CI step (mirroring "Consumer-install smoke"'s shape). `ci.yml`'s existing "Consumer-install smoke" step runs `npm install --no-audit --no-fund "$REPO/$TARBALL"` (a local tarball path, no `--no-save`), which makes npm record `"@dtmd/flume": "file:<path>"` in the consumer's `package.json`. Reproduced locally (hermetic env, no ambient `FLUME_*`): with that pin recorded and no install provisioned at `<flumeDir>/node_modules/@dtmd/flume`, `engineHandshake` (`src/cli.ts:210`, v0.7 §10 arm 2) refuses every subcommand — including the step's own `flume status` and `flume render notes` — exit 2, "provision the pinned install ... or drop the pin to run unpinned". `cli.test.ts`'s handshake suite confirms this is intended arm-2 behavior, not a fluke. The handshake is dated the same day as this line (2026-07-30 amendment) — plausible this landed after the smoke step was last green, or CI hasn't run since.

Not fixed here: out of `SECOND-REFERENCE-CHAIN`'s declared `files` (that entry may only add a *new* CI step, not touch the pre-existing one), and a `src/` behavior change is out of scope regardless — `.claude/rules/spec-plan-build.md` routes cross-cutting fixes through their own entry. The new backlog-groomer CI step sidesteps the same trap with `--no-save` (an unpinned consumer install, which is what an unpinned bare bay is supposed to look like).

Options:
1. **Add `--no-save` to the existing step's `npm install` line (recommended).** One-line fix, same rationale as the new step: a consumer-install smoke test is exercising "works when installed," not "works when pinned" — pinning is its own tested path (`cli.test.ts`'s handshake suite) and doesn't need re-proving here.
2. **Leave it and let CI prove/disprove this live.** If this write-up is wrong (something about the real GitHub Actions npm resolves differently than local repro), a real run settles it for free. Risk: if it's actually broken, `main`'s CI stays red on this step until someone notices.

Recommendation: option 1 — file as its own entry (not a `SECOND-REFERENCE-CHAIN` scope-creep) so build can land the one-line `--no-save` fix directly.

## INTEGRATION-LANE-NEVER-RUNS-IN-CI — v0.3 §17's integration lane has no CI wiring, and `job.integration.test.ts` hangs

**PARKED**

Context: auditing `SECOND-REFERENCE-CHAIN`'s new `tests/examples.integration.test.ts` against v0.8 §7 ("smoke test drives one full tick cycle ... the existing smoke posture") led to checking whether the integration lane actually runs anywhere. v0.3 §17 excludes `*.integration.test.ts` from the in-worktree gate specifically so it can run "at the host ... pre-merge / CI, not the autonomous gate" via `pnpm test:integration` — but `.github/workflows/ci.yml` never invokes that script (zero hits). Pre-existing gap (the lane already held `job.integration.test.ts` and `loop-process-boundary.integration.test.ts` before this delta); the new file lands into the same never-run lane.

Checked whether it's safe to just add the CI step: ran `pnpm test:integration` locally. `examples.integration.test.ts` (2 tests, 149ms) and `loop-process-boundary.integration.test.ts` (4 tests, ~3s) pass clean. `job.integration.test.ts`'s second case — "§5b ... run refuses while another live loop holds the job's loop.pid" (line 209) — hangs indefinitely (reproduced twice, 120s+, no output past the first test in the file). Repro: `VITEST_LANE=integration pnpm exec vitest run tests/job.integration.test.ts --reporter=verbose`. Not root-caused — plausibly in `jobRun()`'s preflight (`src/job.ts` checkout/wake) before execution ever reaches the `loop` lock-check it's supposed to fall through to (`src/cli.ts` ~1059), but that's a guess, not a diagnosis.

Options:
1. **Root-cause the hang first, then wire CI (recommended).** Two units: the hang is an engine or test defect (unknown which yet); the CI wiring is mechanical once the suite is green. File the investigation as its own build entry once scoped, `blockedBy` on nothing but gating the CI-wiring entry.
2. **Wire CI now with a short per-step timeout.** Fails loudly instead of burning runner quota silently, but papers over the bug — §17 wanted this lane to actually gate merges, not best-effort pass.

Recommendation: option 1.
