# The release lane is yaml a suite already reads

The entry's "no tests[]: the lane is yaml no suite reads" is contradicted by
the tree: tests/bin.test.ts already reads .github/workflows/ci.yml
structurally (trigger, lane steps, the smoke step's script and its scratch
handoff). I shipped two undeclared cases over release.yml on those same
helpers: the `v*` trigger plus npm-publish-under-NPM_TOKEN, and an agreement
case resolving the step's flags against what scripts/smoke-install.mjs
parses. Each verified red under mutation (flag dropped, tags -> branches,
npm -> pnpm). A future yaml lane can carry tests[] lines.

The registry leg was exercised live against the published 0.15.0: it
installs, runs the shim, and holds --version to the spec. It then reds on
the ./harness subpath probe because published 0.15.0 predates that export
(44629824). Expected, not a defect: the probe tracks the working tree, so
registry mode is only meaningful for the version the checked-out tree
carries, and the workflow's tag/manifest agreement step is what guarantees
that pairing.
