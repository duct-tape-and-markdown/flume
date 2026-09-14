# The API reports no inventory of live worktrees (consumer survey)

Observed at 71dd757. `readWorktreeRegistry` (`src/worktrees.ts`) answers "which paths does git register as this repo's worktrees" for provisioning and the startup sweep, and is not on `FlumeApi` (`src/flumeApi.ts:184` exposes `showNameOnly` and `readFileAtRef` only). One consumer (`docs/surveys/consumer-chains/consumer-d.md` §3 #4, §7) allocates a Postgres database per fanout arm in `setupWorktree`, drops it in `teardownWorktree`, and runs a reaper with a safelist that enumerates `.flume/worktrees/` directly to find databases orphaned by worktrees that no longer exist — the survey's only instance of a chain reading an engine-owned directory.

Why it matters: the engine owns the worktree lifecycle and the chain owns what hangs off it, with no shared list (`engineering.md`, *A fact the engine holds is reported*). Exposing the registry read on the API gives the reaper a fact instead of a directory walk.
