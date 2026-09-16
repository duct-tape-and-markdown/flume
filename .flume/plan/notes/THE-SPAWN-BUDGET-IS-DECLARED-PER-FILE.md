# Per-file budget shipped; per-site numbers are now unjudged

30 default-lane files gained `vi.setConfig({ testTimeout, hookTimeout })`
above their first registrar. The scan's judged unit is the file, so
`SpawnSite.budget` and the registrar-timeout reader are gone: a per-case
`, SPAWN_BUDGET_MS` still ships (the sweep's to remove) but nothing reads
it, and nothing reads a per-case *literal* any more either. Those literals
are live and unseen: `worktrees.test.ts` (30_000 x4),
`cliJobResolution.test.ts` (30_000), `builtinGates.test.ts` (20_000,
30_000), `Gate.test.ts` (60_000 x4) now sit *below* the file budget, so
those cases keep a ceiling smaller than the lane's; `harnessRunner.test.ts`
(180_000, 240_000) sits above it, which may be deliberate. Either way the
old per-site check that reported them is not replaced — worth an entry
deciding whether a registrar literal on a spawning site is a finding.

Second: `git` in the vocabulary makes `Dispatcher.test.ts` report 252
spawning sites. The propagation is scopeless and name-wide, so that is
over-approximation, not a spawn count; it decides one file verdict today,
but a future per-site verdict would be noisy there.
