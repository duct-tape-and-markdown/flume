# The render seed reported 54 default-lane cases, not the 6 the entry named

Seeding `renderPrompt` into the spawn scan (tests/helpers/spawnBudget.ts,
`SHELL_ENTRIES`) reported 54 inheriting cases across six files:
Prompt.test.ts (31), harnessPrompts.test.ts (12), examples.test.ts (6),
harnessChain/harnessBuildArgs (2 each), priorAttempts (1). All now declare
`SPAWN_BUDGET_MS`; the whole-lane assertion is green over 292 sites, 0
inheriting.

Two things worth a plan eye:

- The scan resolves no scopes, so the seed is the bare identifier
  `renderPrompt`. A lane file declaring an unrelated local of that name is
  over-flagged (one unneeded ceiling, the propagation's standing trade), and
  a file rendering through a differently named engine entry is missed.
  `SHELL_ENTRIES` is a hand list, like `NODE_COMMANDS`: no surface
  enumerates which engine exports start a process.
- Span rendering is now the lane's largest startup surface by case count —
  one `sh` per span, per case. If the fast lane's wall clock becomes the
  constraint, that block, not the CLI spawns, is where the seconds are.
