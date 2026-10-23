# A coverage case is green under the gate's runner and red under `pnpm test`

Landed: the stderr case's inert `--` and its comment are gone, and one pin
reads every spawn the runner makes — the two runs plus the three listings a
scoped read over an idle lane takes — asserting the subcommand leads and the
reading flags follow. Measured again here (node 24.21): `node -e "<code>" run
--reporter=json` runs the code and exits 1; without the leading positional it
exits 9 `bad option`.

Found while running the file: `tests/harnessRunner.test.ts`'s case *a listing
vitest cannot produce leaves no coverage known rather than an empty set* is
red on this host under `pnpm test` and `npx vitest`, and green under `node
<vitest.mjs> run` — the spawn `resolveVitest` (`harness/vitestRunner.ts`)
makes. It reds on the base tree too.

Cause: pnpm's `node_modules/.bin/vitest` shim exports a module search path
holding `node_modules/.pnpm/node_modules`, which the hoisted store fills with
every package. So `createRequire(<tmp>/package.json).resolve("vitest/package.json")`
answers from a directory with no dependencies, the listing spawns, and
`coverage` returns `known` where the case's whole premise is that vitest is
unresolvable there. The case's premise holds only when the suite is driven by
the tool rather than by a package-manager shim — the same split
`.claude/rules/platform-facts.md`, *A package-manager shim carries the
manager's state into a gate*, states for gates, biting a fixture instead.

Why it matters: `.github/workflows/ci.yml` runs `pnpm test`, and the case
landed in 9f43010b today, after the last CI run — so the next CI run reds
there while every flume gate stays green, since the named-lines gate reaches
vitest through `resolveVitest`. The fix is the fixture's, not the runner's:
deny the resolution structurally rather than by absence of a `node_modules`
(the search path reaches past the tree), or drive the arm through an `invoke`
that cannot resolve.
