# `harness/windows.ts` holds four jobs and `harness/chain.ts` disclaims two it carries

Filed from a structural review of `harness/` at 57bd960, under
`.claude/rules/engineering.md` *A module is one job*. Read-only findings;
target shapes named so build moves code rather than judging it.

**`harness/windows.ts` (758 → 1161 lines in one day) is four modules.**

- Slice assembly: `planSliceWindows`, `PlanSliceWindow`, `SLICE_DATA_KEYS`,
  the `window()` switch (~208–230), which is already the seam.
- The inbox window, with records, refusals and the CI lane (~232–589).
- The derive and sweep windows (~591–842).
- A git range-scan library — `RangeCommit`, `git`, `resolves`,
  `commitsPast`, `touches`, `touchedPast`, `diffOf`, `retiredLines`,
  `renderPrefix` (~944–1161) — that knows nothing about slices.

Evidence the CI feature is cut along the wrong line: `tests/harnessCi.test.ts`
(920 lines) never calls `readCiLaneStatuses` or `withCiLaneMaterial`; it drives
`planSliceWindows` and asserts on strings rendered in `windows.ts`. The lane
liveness rule (`wokenLanes`, ~384–397) is neither forge I/O nor render and
sits between two render functions; `ci.ts:42` declares "This module is the
reader alone."

Target: `windows.ts` keeps assembly (`planSliceWindows`, `PlanSliceWindow`,
`SLICE_DATA_KEYS`, `bounded`/`refusal`); `gitRange.ts` takes the range-scan
library; `inboxWindow.ts`, `deriveWindow.ts`, `sweepWindow.ts` each export one
`(options) => PlanSliceWindow`; `ciLane.ts` takes the lane's liveness and
render (`wokenLanes`, `renderCiLanes`, `renderRun`, `renderStamp`,
`renderLane`, `ciLaneStatuses`) as `laneLeg(options): { live, render }`, so
`harnessCi.test.ts` has a module matching its name. Also in `windows.ts`:
`specWindow` (~628) and `sweepWindowOf` (~762) are the same six lines, and
`{ pending?, priorAttempts? }` is spelled three times (`SliceInputs`,
`WindowContext`, `standingRefusals`' param) — one `cursorWindow(field, globs,
ctx, render)` and one `TickFacts = Pick<TickContext, "pending" |
"priorAttempts">`.

**`harness/chain.ts:7` says "The assembly point, and nothing else."** Lines
~359–452 are the judge-as-gate (`namedLinesGate`, `details`, `isPark`), and
~454–511 are consumer-gate construction (`registry`, `constructGate`,
`shellCommand`), which `gates.ts:29` disclaims only because "this module
spawns no process". Target: `judgeGate.ts` exporting `namedLinesGate(runner,
isPark)`; `constructGate`/`registry`/`shellCommand` into `gates.ts` as
`declaredGates(api, phaseGates)`. `chain.ts` drops to the assembly its header
promises.

**Three sync spawn wrappers where one would do.** `windows.ts` `git()`
(~1069), `ci.ts` `branchAt()` (~341, whose comment says it duplicates the
engine's `currentRefPath` because that is async), `ci.ts` `forge()` (~466,
re-deriving `execFileWithShimRetry`'s win32 retry synchronously). Beside
them `64 << 20` at `ci.ts:126`, `windows.ts:1046`, `vitestRunner.ts:45`, and
`err instanceof Error ? err.message : String(err)` at four sites. Target:
`harness/exec.ts` with `execSync(cmd, args, { cwd, env? })` carrying the shim
retry, the buffer and `detailOf`; `git()` and `forge()` become one-liners.
The upstream cause — `shouldRun`/`promptArgs`/`handoff` being sync surfaces —
is an engine question named here, not proposed.

**The plan-artifact layout has four homes.** `pending.json` is the engine's,
`state.json` is `planState.ts:40`, `inbox/` and `notes/` are
`records.ts:33–43`, `open-questions.md` is `prompts.ts:106` ("Spelled here
because nothing else owns it"). `chain.ts:201–206` assembles the fence from
all four, and the queue's git path is spelled three ways — `chain.ts:202` and
`init.ts:380` through `gitPath(resolvePendingPath(...))`, `gates.ts:147`
through `join(ctx.stateRootRel, relative(...))`, the `node:path` composition
`posture-sweep.md` names as a lens. Target: `harness/layout.ts` exporting
`planArtifacts(stateRoot)` and the individual path functions; the three
modules import theirs, and `gates.ts` spells the queue path as `chain.ts`
does.

Checked and not found: module-level hidden state, value-edge import cycles,
undeclared special cases in generic code, consumer restatement of engine
facts beyond the sync re-reads above. Every CI change this day extended an
existing schema, predicate or key table; the flatness is inside
`windows.ts`, not in the package's seams.
