# checkoutAt landed; three things plan should route

**`harness/vitestRunner.ts`'s `runAtBase` not adopted.** `checkoutAt` refuses
outside a gate invocation — reclamation is the engine's *at the gate
boundary*, and off that path nothing would remove the tree (engineering.md,
*Loud or nothing*). `tests/harnessRunner.test.ts` drives `runner.runAtBase()`
directly, no gate in flight. Adopting needs a decision: a declared scope seam
for the runner, or rewriting those tests to reach it through a real gate. The
hand-rolled checkout the entry note named still stands.

**Namespace gap, inherited not introduced.** `checkoutAt` plants at
`worktreesBase(flumeDir)`, exactly where `runAtBase` does. Under a job
namespace `sweepStaleWorktrees` scans `<wtBase>/<ns>` only, so a run killed
mid-gate leaves a checkout at the bare base the sweep never reads. Nothing to
key on: `namespace` is on neither `GateContext` nor `FlumePaths`. Bites only
under a shared `FLUME_WORKTREES_DIR`.

**Stale-on-growth pin.** `tests/worktrees.test.ts` "src/ resolves the worktree
base in exactly one place" hardcodes a consumer count (bumped 2 -> 3 here).
Every new `worktreesBase` caller reds it for no defect.
