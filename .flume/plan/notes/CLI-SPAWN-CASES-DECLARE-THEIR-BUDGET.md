# Declared budgets already existed — scattered, not absent

The entry's premise ("zero declared budgets anywhere in the tree") is wrong:
~100 default-lane sites already declared one, at six different numbers
(20/30/60/120/180/240s, none stating why). The defect was restatement, not
absence. Shipped as one home (`SPAWN_BUDGET_MS = 120_000`, ≥ every value it
replaced, so no site lost headroom) plus a scan over the whole lane.

Scope landed wider than `entry.files`: the scan's subject is "a default-lane
case or hook that starts a node process", which also catches `git.test.ts`,
`builtinGates.test.ts`, `harnessRunner.test.ts` and three spawning `beforeAll`
hooks (hooks inherit `hookTimeout`, lower still). 199 sites, 15 files.

Left standing, maybe an entry: `harnessRunner.test.ts` runs a real vitest in
the **default** lane at 180_000–240_000 per case (13s measured), and
`Dispatcher.test.ts` carries ~150 `20_000` literals. Neither reaches
`process.execPath`, so the scan does not judge them — same restated-number
shape, and the vitest-in-vitest cases look like a lane question.
