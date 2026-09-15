# Fixture roots fold at creation; ~160 raw temp roots still don't

`mkTempDir` (tests/helpers/subprocess.ts) is the one home: `mkdtemp` +
`realpath`. `makeFixture`, `mkFixtureRoot` (every CLI suite) and
harnessRunner's own root now go through it.

Not covered: ~163 `mkdtemp(join(tmpdir(), ...))` sites across 38 test files
still name their root by the env's spelling. Most are scratch dirs that never
meet git, but several `git init` in place — git.test.ts, chain.test.ts,
harnessGates.test.ts, setupWorktree.test.ts, build-changelog.test.ts,
harnessWindows.test.ts. Any of the windows lane's remaining 27 reds that
compares a composed path against git's output is this same class, and the fix
is mechanical (swap the call for `mkTempDir`). Worth one entry once the lane's
next run names which are still red — sweeping all 163 blind churns files no
red implicates.
