# The command-name vocabulary reports more than the three predicted sites

The widening took the scan from 202 to 228 sites: 26 were inheriting, not 3.
Beyond Gate.test.ts (9 real `cmd: "node"` spawns), builtinGates:693/699 and
harnessPackaging:457, it reports 13 cases that start nothing — the
child_process-mocked suites (setupWorktree ×4, spawnShim ×4) and gate cases
that only build or render a command (builtinGates:777/790/952/967,
Prompt:354). All 13 now carry SPAWN_BUDGET_MS, several on sync cases.

Judgment call, made uniformly rather than silently narrowed: once a startup
is spelled as a name, no syntactic rule separates a name handed to a runner
from one asserted on — `expect(cmd).toBe("pnpm")` and `exec("npm", args)` are
both call arguments. The helper's declared trade (over-approximate; a missed
site costs the flake) chose this side, so the scan stays judgment-free and
the cost is a ceiling those cases never pay. If that reads as noise, the fork
is a declared-at-site opt-out vs. accepting it — a plan decision, not mine.

Caught in passing: builtinGates' `npm exec -- tsc` case restated `30_000`;
it is on the shared constant now.
