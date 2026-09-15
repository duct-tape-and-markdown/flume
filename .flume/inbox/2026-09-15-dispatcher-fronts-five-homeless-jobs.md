# `src/Dispatcher.ts` fronts five jobs with no home, three of them import cycles

Filed from a structural review at 57bd960, under
`.claude/rules/engineering.md` *A module is one job*. The module is 4,894
lines, one class of 3,070, `runFanout` at ~860 lines and `runSingleton` at
~528; +1,131 lines since the package cutover with the module count of `src/`
unchanged. The day's individual changes landed at the mechanism (0f4b08b
unified six hook seams into two guards; 4687739 collapsed six gate-row
literals; 16e3447/1f34333 adopted `fsProbe.isDirectoryOrAbsent` rather than
re-spelling the errno split). None moved a job out.

**Five jobs in front of the class, with no `src/` home:**

- Tick-verdict I/O: types, `writeTickVerdict`, `readTickVerdict(s)`,
  `readLatestVerdictsSync`, `clearTickVerdict` (~117–880), consumed by
  `cliVerdict.ts`, `loopSupervisor.ts`, `harness/handoff.ts`.
- Merging markers (~687–762).
- Chain loading and declaration validation: `loadChainModule`,
  `diskChainLoader`, `validatePendingPathDeclaration`,
  `resolveWorktreesBaseDeclaration`, `validateNoDeadDeclarations`,
  `CjsContextLoadError` (~1018–1300), consumed by `builtinGates.ts`,
  `job.ts`, `cliChainLoad.ts`, `cli.ts`.
- Exit codes `EX_TERMINAL_MISCONFIG` / `EX_MOUNT_DEAD` (~1430–1444).
- `Logger` / `consoleLogger` (~990–1005), imported by `worktrees.ts`,
  `priorAttempts.ts`, `friction.ts` — modules Dispatcher itself imports. A
  type-only cycle that exists only because `Logger` has no file.

By contrast `priorAttempts.ts`, `worktrees.ts`, `git.ts`, `paths.ts`,
`partition.ts`, `Baton.ts` are homed and Dispatcher orchestrates them.

Target: `src/tickVerdict.ts` (types, I/O, merging markers);
`src/chainLoad.ts` (load, validation, `CjsContextLoadError`); `src/log.ts`
(`Logger`, `consoleLogger`); the exit codes to `cliVerdict.ts` or
`src/exitCodes.ts`. About 1,300 lines out with no behavior change, and the
cycles break. `src/index.ts` keeps exporting the same names from their new
homes; the export pin holds the surface.

**Two legs spelling one sequence, and a third copy of the selection.**
`runSingleton` (~2376–2470) and `runFanoutEntry` (~3700–3815) each spell
render → `revParse` → `invokeAgent` → `revParse` → `checkTipMovedPerEntry`
→ `runAfterCommitGates` → `revertAfterCommitFailure`, differing only in how
the outcome is returned; the `renderPrompt` try/catch is copied at ~2380 and
~3709. `render()` (ebcd496, ~2071–2178) re-spells the fanout batch
arithmetic at ~2099–2131 (`pickableEntries` + `partitionByFileOverlap` with
the same two `supervisorPolicy` reads) instead of taking it from `runFanout`
(~2799–2813). Target: one `runAttempt(phase, wt, ref, label, entry?)`
returning `{ termination, committed, tipMoved, verdict }` both legs call;
one `selectBatch(chain, pending)` that `runFanout` and `render` both call.

Checked and not found: the citation-scan commits on this file changed zero
code lines; the growth is real code plus prose, not churn. `fsProbe.ts` was
followed as a precedent for a split, never for a job.
