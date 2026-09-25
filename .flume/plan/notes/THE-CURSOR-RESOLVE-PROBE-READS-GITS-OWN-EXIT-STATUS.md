# The tolerance moved to init; "which exit status" is spelled three ways

**The catch did not vanish, it got an owner.** `resolvesInTree` was the only
thing making `harnessInit` survive a `repoRoot` that is no git checkout at all
(exit 128), which `PlanStateOutcome`'s `no-commit` arm declares as a real
adoption input. Tightening the probe to git's exit 1 moved that tolerance to
`tipIfAny` (`harness/init.ts`), where the degraded path is declared and the
bound named. The existing `no-commit` case claimed both legs in its prose and
exercised only the commitless-repo one; the non-checkout leg now has its own
case in `tests/harnessInit.test.ts` with a vacuity guard that reads git's
refusal rather than assuming it.

**Three readings of a child's exit status, no shared home.**
`harness/exec.ts` now exports `exitStatusOf` (sync spawns, node's `status`,
`undefined` where the child never exited), shared by `gitRange.ts` and
`ci.ts`'s `branchAt`. But `src/git.ts`'s `isAncestor` still casts for `code`
inline — the async spelling of the same decision, and the one the entry cited
as the shape to follow — and `tests/helpers/subprocess.ts` exports a third
`exitStatusOf` with a different contract (async `code`, throws rather than
answering `undefined`). Two exported symbols of one name, three decodes of one
question. Not correctness-adjacent today: each is right for its own spawn API,
and `src/` cannot import `harness/`. Worth a cohesion read on whether the
engine's async status decode wants a name (`engineering.md`, *A module is one
job*), and on whether the tests helper should be the one that renames.

**Not swept:** every other bare `catch {}` in `harness/`. `touchedPast`
(`gitRange.ts`) fails open and says so; I did not audit the rest.
