# A default-lane case inheriting the 5s default timed out under full-suite contention

Shipped as filed: the pin rides `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n` on the
worker's env, so it reaches the ~25 `git init` sites, `hermeticEnv()` copies,
and the git a spawned `flume` runs — no creation site edited.

Observed while proving the lane green: on the first of two full `pnpm test`
runs, `tests/examples.test.ts` > "the example plan template's artifact spans
fail the render when an artifact is present but unreadable" failed with
`Test timed out in 5000ms`. It passes alone in ~650ms and the second full run
was green, so it is a contention flake, not this entry's doing — it starts no
process and touches no git.

Why it matters: the afterMerge gate runs this lane once per cherry-picked
entry, so a 5s-default case that is 8x over budget alone reverts an innocent
entry under a wide wave (spec/worktrees.md, "The default test lane must stay
fast" — the same failure mode the spawn budget was introduced for, here on a
case that spawns nothing). The budget helper only covers node-starting sites,
so nothing currently detects this class.
