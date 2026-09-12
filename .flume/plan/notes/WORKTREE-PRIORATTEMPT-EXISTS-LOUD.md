# Shipped; the refusal lands at the probe, and the existsSync cohort is down to seven

Acceptance wording: an unstattable worktree path does *not* "reach the
registry refusal" — `existsLoud` throws at the probe, before
`readWorktreeRegistry` runs. Same outcome (nothing provisioned or removed
over the occupant), one rung earlier. Noting so a later tick does not
re-file it as unmet.

Remaining `existsSync` in `src/`, for whoever sizes the rest of the sweep:

- `Dispatcher.ts:656/676/711` — `readTickVerdict`, `readTickVerdicts`,
  `readLatestVerdictsSync`. An unstattable verdict log reads as "no
  history" and silently feeds empty history into a prompt.
- `Dispatcher.ts:1022` — chain.ts presence. Unstattable yields "chain
  config not found", pointing the operator at the wrong defect.
- `setupWorktree.ts:63/64` — lockfile detect. An unstattable
  `pnpm-lock.yaml` demotes the worktree to npm.
- `cli.ts:287`, `cliJobResolution.ts:52` — flumeDir / ancestor `.flume`
  walk. Unstattable reads as "no state root here"; the walk continues.
- `Dispatcher.ts:3985` — `readPendingTolerant`. Declared and cited as the
  bounded degraded path; leave it.
