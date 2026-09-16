# Adoption now puts a registry range in the smoke consumer's manifest

Measured here against the packed 0.16.0: the chain init writes fails to load
on node 22.20 and 22.23 without `.flume/package.json`, loads on both with it,
loads either way on 24. The two node-22 CI lanes carry this; the default
vitest lane on a 24 host cannot see it.

Consequence the entry did not name: init adds `@dtmd/flume@^<version>` to the
smoke consumer's manifest, so every later `npm install` there resolves that
range from the registry — on a release-cut commit the version is unpublished
and npm exits ETARGET (reproduced). ci.yml's "Consumer type-resolution gate"
therefore got its own consumer dir under the same scratch root; the tarball is
still the handoff between the steps. Whether that npm behavior earns a
platform fact is the human's call.

Left standing: `tests/harnessInit.test.ts` now drives the engine's loader over
a CommonJS-scoped consumer, which on a node-24 host passes with or without the
manifest. The manifest's content and its place beside `chain.ts` are pinned
directly, so a regression reds; the module-scope consequence only bites where
node <= 22.23 runs.
