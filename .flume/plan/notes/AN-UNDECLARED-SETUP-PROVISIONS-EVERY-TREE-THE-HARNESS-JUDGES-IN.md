# One provisioning answer, and the three fixtures that were living off the parent

Shipped as specified: an undeclared `setup` now installs at every provisioned
tree's root (worktree hook no longer withheld), and a no-lockfile tree with no
`setup` is refused at chain load.

Two places the work diverged from the entry's file prediction, both deliberate:

- The refusal lives in `harness/provisioning.ts`, not `harness/declaration.ts`
  (untouched). The undeclared arm is *chosen* there, next to the restore's
  load-time shell probe — same shape, same reason. A schema-side spelling
  would have been a second reader of `setup`'s absence.
- The lockfile set was a consumer restatement waiting to happen, so the engine
  now reports it: `installPlan` (`src/setupWorktree.ts`) returns the install a
  directory's lockfiles imply plus the whole set it reads, and
  `setupWorktree` decides from it. Harness imports it directly rather than
  through `FlumeApi`: a new api member reds the roster pin in
  `tests/chain.test.ts` until `docs/CHAIN-AUTHORING.md` names it, and
  `harness/provisioning.ts` already imports `src/` modules directly. If a
  downstream chain wants that probe, it is an api member plus a doc row —
  plan's call, not smuggled in here.

Two things for plan to look at:

1. **`flume-harness init` scaffolds no `setup`.** Three fixtures had to commit
   a lockfile to keep loading (`tests/harnessRunner.test.ts`,
   `tests/harnessGates.test.ts`, `tests/harnessInit.test.ts` — the last one is
   the written chain loading under `tsx`). That is the refusal working, but it
   means a consumer adopting into a repo with no lockfile the installer reads
   now fails its first load. Worth deciding whether the skeleton should carry
   a `setup` row, commented or declared.
2. **The break owes a migration section.** `docs/MIGRATING-0.23.md` does not
   exist yet; `docs/CHAIN-AUTHORING.md`'s `setup` clause states the new
   behavior, and the release cut needs the upgrade note.
