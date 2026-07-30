# Open Questions

Decisions parked for human input. Each question is a `##` subsection with status, context, options, and recommended disposition.

Status markers:
- **PARKED** — no movement until human resolves
- **PARTIALLY ADDRESSED** — some progress; remaining ambiguity blocks closure
- **NEEDS AMENDMENT** — answer is clear; requires a spec edit to close

<!-- questions below this line -->

## BUILD-PARK-COMMIT-BEFORE-BAIL — voluntary-bail park notes die with the worktree

**PARKED**

Context: v0.7 §13 established that when build's fence conflicts with the work, the tick parks a note in `open-questions.md` and bails rather than committing into a guaranteed revert — that instruction itself lives in `prompts/build.md`, applied by operator commit (`PROMPTS-BUILD-FENCE-INSTRUCTION`, closed `db645f5`) since prompts sit outside every phase's fence. §15 (shipped `c8ccfd2`) made plan wake on a voluntary-bail, but the park note is written inside the fanout worktree and never committed — worktree cleanup at wave end destroys it, so plan wakes with zero visibility into why. Observed live: the PENDING-SCHEMA-CORE-EXTENSION-SPLIT wave bailed with an uncommitted park, reconstructable only from the session log.

Options:
1. **Prompt fix (recommended).** `prompts/build.md` instructs: when parking a note and bailing, commit that single-file `open-questions.md` edit before exiting (already within build's write allowance for that path) instead of leaving an uncommitted worktree diff. No new engine mechanism — same shape as the already-shipped §13/§15 operator legs.
2. **Engine salvage.** Dispatcher detects channel-path edits in a worktree on voluntary-bail and lands them as a park commit itself. More machinery than the gap needs; `.claude/rules/collaboration.md`'s complexity-is-a-signal rule favors option 1 unless prompt-level discipline can't be trusted to fire every time.

Recommendation: option 1, applied directly to `prompts/build.md` via `chore(flume):` commit — no pending entry, same class as `PROMPTS-BUILD-FENCE-INSTRUCTION`.

## LOOP-SUMMARY-HARDCODED-ABORT-THRESHOLD — completion summary always says "3 consecutive ticks" regardless of the chain's declared abortThreshold

**NEEDS AMENDMENT**

Context: building SUPERVISOR-POLICY-CLI-COVERAGE (v0.8 §8), a real `flume loop` run against a fixture chain declaring `supervisorPolicy.abortThreshold: 2` aborted correctly after 2 ticks (`superviseLoop`'s own `log.error` in `src/Dispatcher.ts` names the real count). But `loopCompletionSummary` (`src/cli.ts:364-386`) hardcodes the count in its own line:

```
`aborted: identical worktree provisioning failure repeated 3 consecutive ticks — ${result.repeatedFailure.signature}`
```

— literal `3`, not the threshold actually in force. Pre-v0.8 this was always true (3 was the only value); §8 makes it a chain-overridable knob without updating this string, so a chain that lowers or raises `abortThreshold` gets a misleading completion line. `SuperviseResult.repeatedFailure` (`src/Dispatcher.ts:2348`) carries only `{ signature }` — the actual streak count isn't threaded out to where the summary is built, so the fix needs either that field to grow a count, or the abort message to move from `superviseLoop`'s own `log.error` (which already has the real number) rather than being reconstructed at the CLI layer.

Not filed as a pending entry here — build's fence for this entry was tests+docs only (`entry.files`), and this is a `src/Dispatcher.ts`/`src/cli.ts` fix outside that scope. Straightforward once scoped: no product judgment call, just a plan entry.
