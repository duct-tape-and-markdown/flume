# The worktree-lock case now counts its own loop; the log cannot count it

The closing assertion is now `expect(blocked).toEqual(["add", "remove",
"prune"])`, recorded as the loop reaches each command's verdicts. Measured:
zero iterations and two-of-three both redden it, three is green. The old
`expect(existsSync(wt)).toBe(false)` stays, but as the ordering claim it
actually is (add planted what remove took away) — a claim only because the
pin above now says add ran.

Two things the next plan tick may want:

- The wait line the loop keys on (`src/waitLock.ts:116`) names the lock's
  label and holder pid, never the caller's command. So no per-command
  evidence exists outside the loop body: three fall-through iterations and
  three blocked ones leave the same disk and the same log. Any future case
  proving "command X runs under lock Y" is stuck with a loop-recorded
  cardinality for the same reason. If that shape repeats, the durable fix is
  on the engine side — `withWorktreeLock` knowing which command it wraps and
  the wait line saying so — which would make the verdict readable off the
  log rather than off a test-local array. Not filed: no drift measured, and
  the label vocabulary (`src/git.ts:1132`) is engine surface a chain reads,
  so widening it is a spec call, not a build one.
- The assertion spells the three names as a literal rather than mapping them
  off `commands`, on purpose: mapped, the pin would agree with whatever the
  list became, so an arm dropped from the literal would still read green
  under a title naming three. The literal is the title's claim restated where
  the body can be held to it. Flagging it because it reads like the
  restatement `engineering.md`, *Derived state is computed* forbids, and a
  sweep lens could file it; the two copies are the title and the assertion,
  which is the direction *A test's title is a claim its body asserts* wants.
