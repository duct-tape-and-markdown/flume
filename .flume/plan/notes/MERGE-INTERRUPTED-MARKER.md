# `merging/` is untracked-visible in every job dir

Shipped as declared; `src/job.ts` `RUNTIME_IGNORES` deliberately left alone
(entry note: `spec/jobs.md` *Runtime ignores* is a closed block missing the
line). Consequence now that the dir is real: a `flume job new` dir's seeded
`.gitignore` covers `awake/`, `prior-attempts/`, `rendered-prompts/`,
`worktrees/`, `loop.pid`, `stop`, `tick-verdict*` — but **not** `merging/`, so
a marker a crash leaves behind shows up as an untracked file in the job's own
`git status` (and, worse, is addable). This repo's own `.gitignore` got the
line; a downstream job dir cannot. Needs the human ruling on `spec/jobs.md`
before `RUNTIME_IGNORES` can grow the entry —
`docs/CHAIN-AUTHORING.md:115`'s list is equality-pinned to it
(`tests/retired-narration.test.ts`), so the three move in one commit.

Second, smaller: `clearMergingMarkers` waits on the ledger rewrite, not the
verdict write — `Dispatcher.tick()` never writes the verdict (the CLI does,
after `tick()` returns), and the hazard closes at the rewrite. Declared and
cited at the site; flagging in case the spec sentence wants tightening.
