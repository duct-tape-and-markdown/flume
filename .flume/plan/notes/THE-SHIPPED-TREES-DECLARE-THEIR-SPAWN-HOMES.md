# The sync half of the home verdict has no answerable question over the shipped trees

The async arm shipped: `scanPromisifiedSpawns` now runs over `REPO_DOMAIN`
with `SHIPPED_SPAWN_HOMES` (`src/git.ts`, `src/spawnShim.ts`), and a probe
wrapper dropped into `src/` reds it at the line it is written on.

What is left unasserted, deliberately, and why plan should not read it as a
gap the next tick closes: the sync arm. Under `tests/` one module is the
declared home and the verdict is sharp. Over the shipped trees the capturing
sync calls are `harness/exec.ts:90`, `:95`, `scripts/smoke-install.mjs:89`,
`scripts/build-changelog.mjs:73`, `bin/execEntry.js:35`, and
`examples/backlog-groomer-chain.ts:258`, `:262` — six modules across four
trees, each of which would have to be its own home. A home list naming all of
them excuses exactly the sites it names, so the verdict would be green by
construction and stay green for the seventh. A blocking capture needs no
construction line, so there is nothing narrower to judge; the answerable
question over that domain is the cap verdict, which already runs.

If that ever becomes worth asking, the shape is not a home list — it is a
declared sync wrapper for the shipped trees the way `tests/helpers/subprocess.ts`
is one for the suite, and only then a home verdict behind it. That is a design
decision, not a mechanical fix.

One smaller observation: `scanPromisifiedSpawns` and `scanSyncSpawns` take
`(root, domain, homes)` positionally while `scanSpawnCaps` defaults its first
two to the repo. The two home scans cannot take the same defaults without
moving `homes` first, so every repo-level caller spells `REPO_ROOT,
REPO_DOMAIN` by hand. Shape only — no behavior rides on it.
