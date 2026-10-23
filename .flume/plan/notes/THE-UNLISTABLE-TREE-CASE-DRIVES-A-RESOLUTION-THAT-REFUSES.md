# The unlistable tree is armed, not assumed

`tests/harnessRunner.test.ts` — "a listing vitest cannot produce leaves no
coverage known rather than an empty set" now plants a `vitest` manifest that
exports its entry point and not its own manifest, so `resolveVitest` refuses
the tree at the nearest `node_modules` and the case reaches the catch arm its
title names. Measured on the base: red under `pnpm test`, green under a
direct `node <vitest.mjs> run`. Two assertions name the planted path, so the
arming is proven load-bearing on a host with no hoisted store too.

`options.invoke` was the entry's named door and turned out unnecessary:
arming the tree keeps the real `resolveVitest` as the producer and its real
message in `reason`, rather than a stand-in throw the tester wrote.

Two things for the next plan tick:

1. A platform fact with no home. A package manager's `node_modules/.bin`
   shim exports `NODE_PATH` holding its hoisted store, so every bare
   specifier resolves from every tree in a process it spawned: a fixture
   standing for a dependency-less tree is inert under `pnpm test` and sound
   under a direct `node` spawn, which is why this case shipped green and
   vacuous. It rides a code comment in the fixture now — the copy CLAUDE.md
   says the harness should own instead — because its home is
   `platform-facts.md`, which no build tick may write.

2. `resolveVitest` reaches vitest through the subpath `vitest/package.json`,
   which resolves only because vitest 2.1.9's `exports` map lists
   `./package.json`. A vitest that stops exporting its own manifest would
   break the runner for every consumer, and the manifest planted above is
   that exact shape. Whether the entry point should be reached some other
   way is a live question, not a hypothetical.
