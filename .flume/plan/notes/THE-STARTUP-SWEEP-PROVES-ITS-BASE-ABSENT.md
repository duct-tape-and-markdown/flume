# The baton's flag reads are the same errno-keyed arm, one layer down

Shipped as written: the sweep's absent-base verdict now comes from
`isDirectoryOrAbsentUnder(ctx.flumeDir, sweepBase)`, its refusal logged rather
than propagated (never-throwing is the sweep's own bound), and the listing past
it keeps no absent arm. The descent composes the `..` legs a declared base
outside the state root produces, so no second resolution of the base appeared —
`worktreesBase(` is still called three times in `src/worktrees.ts`, which the
single-resolution pin counts.

Observed while surveying the family (read-only, verified on disk this tick):
`Baton` (`src/Baton.ts`) still reads its flags off the errno.

- `token` (`src/Baton.ts:119`) returns `undefined` on `ENOENT` alone, so a
  plain file standing at `<flumeDir>/awake` answers "no flag stands" on win32
  and throws on posix.
- `isAwake` (`src/Baton.ts:106`) takes bare `existsLoud`, whose own doc says a
  caller needing a *proven* absence takes `existsLoudUnder` instead. A phase
  reads as asleep over an obstructed state root — a tick that never runs, which
  is the consequence `wake`'s own comment already cites *The fix lands at the
  mechanism* for.
- `sleep` (`src/Baton.ts:156`) swallows `ENOENT` on the `rmSync`: the same host
  split, spelled as a removal no-op.

The three are one entry's worth of work (`existsLoudUnder` for the two reads,
the descent for the removal). It may overlap
`.flume/plan/questions/does-a-read-verb-create-the-awake-directory.md`, which
is about the same directory from the other end — worth answering before filing,
since whether a read verb may create `awake/` decides whether the descent's
silent arm can ever be reached in a live run.
