# The harvest is the one friction surface left without the skip

Shipped: `isDotName` (`src/paths.ts`), applied by `countFrictionFiles`
(`src/job.ts`) and both arms of the `friction` verb (`src/cli.ts`). The
entry scoped out `harvestFriction` (`src/friction.ts`), and the spec section
does not name it, so it still moves dot-prefixed files.

Observed while there: a harvested file lands as `<tag>--<stamp>--<name>`, so
a harvested `.gitkeep` arrives in the primary dir under a name that is no
longer dot-prefixed and the new skip cannot see it. The harvest's
tracked-at-HEAD bound covers the usual case (a placeholder exists because
git forced it, so it is committed, so it is not harvested), but an untracked
dot-prefixed placeholder in a worktree mirror still converts into a counted
note. Whether that is a defect or the harvest correctly staying
content-blind is a spec call, not build's.

Also updated, both outside `entry.files`: the `friction` subcommand help
(`src/cliHelp.ts`) and `docs/CLI.md`, both of which claimed one row per file
directly under the channel dir.
