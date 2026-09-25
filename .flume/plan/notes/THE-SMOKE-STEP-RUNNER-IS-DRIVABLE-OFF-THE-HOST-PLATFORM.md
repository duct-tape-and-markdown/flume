# scripts/*.mjs are now in the program but still unchecked

Making the smoke importable needed `allowJs: true` in tsconfig.json: without
it `tests/bin.test.ts`'s import of `scripts/smoke-install.mjs` is TS7016 and
the tsc gate reds. Measured: with allowJs the whole repo typechecks clean.

Two things that follow, both plan's call:

1. `checkJs` stays off, so the bodies of `scripts/*.mjs` are still typechecked
   by nothing — a script is now in the program and reads as covered while its
   own types are not read at all. Only the modules a test imports enter the
   program at all (smoke-install.mjs, directInvocation.mjs); pack-harness-
   assets.mjs is reached by nothing. Turning `checkJs` on is a wave of its own
   (three scripts, implicit-any params throughout), and `scripts/**/*` is
   deliberately still out of `include` — `tests/helpers/commentCitations.ts`
   states that no tsconfig covers `bin/` or `scripts/`, and the page-name arm
   of the citation scan leans on that.
2. The direct-invocation guard now has one home,
   `scripts/directInvocation.mjs`, taking the caller's `import.meta.url`;
   build-changelog.mjs imports it and the long declared divergence from
   onDiskIdentity moved with it. A third script wanting the guard gets it for
   free. Measured while writing this: the citation pin resolves no declaration
   a `.mjs` holds, so a tests/ comment citing one reds and must name the file
   instead — the four sites cost a red run before rephrasing.

Not filed, observed: the smoke's steps are one 120-line `main()` whose body
is the whole pack->install->adopt->load sequence. Nothing in it is driveable
apart from the step runner — the install target composition, the registry
version parse (a local IIFE), and the shim naming are all still reachable
only by running the real pack and install. If a future finding wants one of
those checked, the split is `main()` into named steps, not another export.
