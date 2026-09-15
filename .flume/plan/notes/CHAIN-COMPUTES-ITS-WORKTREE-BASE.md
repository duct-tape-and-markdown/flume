# Chain-declared worktree base: two things for plan

**Precedence was mine to choose.** spec/worktrees.md states the env branch
and the chain branch, never their order. Shipped as `FLUME_WORKTREES_DIR` >
declared > `<flumeDir>/worktrees` (`worktreesBase`, src/paths.ts; pinned in
tests/paths.test.ts): the env var is the operator's, on a host whose
committed chain.ts they may not own. The reverse is a one-line flip plus two
pins if the spec means otherwise.

**The harness has no seam for it.** `harness/vitestRunner.ts`'s `runAtBase`
plants its base checkout at `worktreesBase(api.paths.flumeDir)` — no declared
value is reachable there, since `FlumeApi` is built before the factory that
returns the declaration. Unreachable today (harness/declaration.ts exposes no
`worktreesBase`, so no harness consumer can declare one), but the moment it
does, `RunnerContext` must carry the evaluated base or the runner checks out
at the engine default while every tick worktree lands at the declared one —
the two-resolutions defect, one package boundary out. Same seam the prior
entry's note needs for `checkoutAt` adoption.
