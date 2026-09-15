# The predicted chain-side twin never fired

The entry's note expected `.flume/declaration.ts:63` to refuse at chain load
until an operator edited it. It does not: `vitestRunner(options)` keeps its
call shape and now *returns* the factory, so `runner: vitestRunner({ lanes })`
is already a declared `(api) => Runner`. Nothing under `.flume/` needs
moving, and no tick refuses. The only consumers this breaks are ones that
declared a hand-built `Runner` object — none in this tree.

Two things plan may want to read:

- The base checkout now lands at `<worktreesBase>/base-<sha7>`, sharing the
  live run's worktree base. The name is stable, so a second judge over the
  same base sha in the same base dir would collide. Safe today because
  afterMerge gates run per entry, sequentially (`src/Dispatcher.ts` ~2115);
  it stops being safe if merges ever overlap.
- `worktreesBase(api.paths.flumeDir)` is still imported from `../src/paths.js`
  rather than read off `FlumeApi` — the parked question's call, unchanged.
