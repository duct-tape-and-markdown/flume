# One friction renderer shipped; two stale cites left behind

`renderFrictionCount` (`src/friction.ts`) now owns all three friction
wordings; `frictionCountLine` is count + render, and `src/cliJobVerbs.ts`
composes only the two-space row separator. The agreement pin lives in
`tests/cliJobVerbs.test.ts`, not the predicted `tests/friction.test.ts`:
driving both *real* CLIs needs `makeJobRepo`/`writeRepoConfig`/
`minimalChainSrc`/`runCli`, all of which sit in that file. Copying them into
friction.test.ts would have re-authored the fixture by hand, which is what
the seam-gate rule forbids.

Observed, not fixed (out of this entry's scope, both pure prose):

- `tests/cli.test.ts:849` still cites `frictionCountLine` as living in
  `src/Dispatcher.ts`; it moved to `src/friction.ts` at the extract commit.
- `src/job.ts:451` says `countFrictionFiles` is exported "so
  `frictionCountLine` shares this split" — true, but `renderFrictionCount`
  is now the second sharer, and `flume job status` reaches it via
  `JobStatus.frictionCount`.

Both are one-line sweep fodder, not correctness-adjacent.
