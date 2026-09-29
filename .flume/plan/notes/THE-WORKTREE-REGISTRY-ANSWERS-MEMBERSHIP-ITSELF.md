# The registry now folds; the platform fact behind it has no home

Shipped: `WorktreeRegistry` carries `worktreeAt(path)`, which folds git's
spelling and the caller's through `canonicalDir` before deciding, plus the
branch on the positive arm. Provisioning's occupied-path leg and the sweep's
scope leg ask it; the reported `worktrees` map is unchanged (git's spelling,
`-z` fidelity pins untouched), so the fourth root-identity comparison in
THE-ROOT-IDENTITY-COMPARISONS-FOLD-BEFORE-THEY-REFUSE is closed and the
`stampVerdict` fold is now reachable at both readers.

Two things for the next tick:

1. **A measured platform fact with no rung.** `git worktree add` records the
   path the OS holds for the directory — the realpath — whatever spelling the
   add reached it through, while `git worktree remove` accepts either
   spelling (probed on git 2.x, linux). That asymmetry is the whole defect:
   any state root reached under a second name composes worktree paths git
   will never print, and only the removal half forgave it. It is external, so
   no test pins it and no type holds it; it belongs on
   `.claude/rules/platform-facts.md`, which a build tick cannot write. The
   new tests lean on it (`tests/worktrees.test.ts`, the three
   second-spelling cases) but do not state it as a fact.

2. **The map is still a matchable surface.** `registry.worktrees` keys by
   git's spelling because two pins read that fidelity, so a chain can still
   spell `worktrees.has(resolve(p))` and get the pre-fix bug one package
   boundary out. `docs/CHAIN-AUTHORING.md` now names that as the bug and
   steers to the verdict, and the `FlumeApi` hover states the question rather
   than the map — prose, one rung down from a check. No downstream restatement
   exists in this repo (`examples/`, `harness/`, `.flume/chain.ts` all clean),
   so nothing is fileable today; a sweep of an external chain is where this
   would bite.
