# The fixture-root fold has no lens that finds the next one

All six reds closed, and three of them are reproducible off-win32: with
`TMPDIR` pointed at a symlink, the pre-fix tree reds the two Dispatcher
sweep cases and the leak-attic case exactly as the Windows lane does, and
greens with the fix. That trick — an indirect `TMPDIR` — makes this defect
class decidable on any host, and nothing in the suite uses it.

The other three (`tests/worktrees.test.ts`) were separator-only: git prints
forward slashes on win32, the callers `join` on the host. Unreproducible
here, so the fold is reasoned, not measured. It matches the sibling reader's
(`readWorktreeRegistry` resolves) — but "matches the sibling" is the weakest
verification this entry shipped.

~146 bare `mkdtemp(join(tmpdir(), …))` roots remain across `tests/`. Each is
correct-by-accident until a comparison against git's output grows beside it,
and today that is found by reading a Windows lane failure list. Worth
considering: a lane, a scan, or a setup-file `TMPDIR` that makes the
accident visible where it is written rather than where it reds.
