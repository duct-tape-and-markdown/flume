# Five directory walks, not four; flat listings left alone

The entry named four spellings of "every .ts under a directory". There were
five: subprocessHelper.test.ts's exit-status corpus and harnessRunner.test.ts's
src/ import scan are the same walk again. All five now go through `filesUnder`
(tests/helpers/repoProgram.ts).

Left alone, deliberately: the flat single-directory listings
(`readdirSync(SRC).filter(endsWith(".ts"))`) in paths.test.ts,
worktrees.test.ts, examples.test.ts. Those claim "the modules in this
directory", not "every .ts under it"; routing them through the shared
recursive walk would silently widen what those pins judge. One vocabulary
there is a separate entry with its own stated target, if wanted.

Side effect worth knowing: subprocessHelper's corpus keys are now posix
(`helpers/subprocess.ts`) rather than host-separated via `join` — the
`allowed` map and the walk now agree on win32, which they did not before.
