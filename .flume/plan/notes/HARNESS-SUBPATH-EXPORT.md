# Two spec sentences the layout move now contradicts

Shipped as planned: `tsconfig.build.json` gained `harness/**` and an explicit
`rootDir: "."`, so the emit is `dist/src/` + `dist/harness/`, and the manifest,
both bin shims and the CLI's own manifest hop follow.

Two spec sentences no longer match the tree, both outside this tick's lane:

- `spec/chain.md`, *The package a chain loads through*: "A strict,
  single-entry `exports` map. `"."` only — no subpath patterns". `./harness`
  is a second entry (not a pattern), which `spec/harness.md`, *Where it
  lives* now mandates. The two pages disagree; one is the defect.
- `spec/cli.md`, *Distribution* names the bin's target as `dist/cli.js`
  twice. It is `dist/src/cli.js` from this commit.

`spec/chain.md`'s standing acceptance (deep paths fail at module resolution)
still holds and now has a check: `tests/harnessPackaging.test.ts` asserts
`@dtmd/flume/dist/harness/index.js` is refused with
`ERR_PACKAGE_PATH_NOT_EXPORTED`.
