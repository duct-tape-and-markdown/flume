# A third long-path ceiling has no home in platform-facts.md

`platform-facts.md` names two win32 ceilings: the ~260 fs limit
`toNamespacedPath` fixes, and `git worktree add`'s ~200 refusal it cannot.
The lane (35016231910) showed a **third**: win32 refuses to *create a
process* whose working directory exceeds MAX_PATH, surfacing as
`spawn git ENOENT`. `toNamespacedPath` cannot reach it either — the OS
resolves the cwd, so no flume-built path is involved. It is why the two job
fixtures died before reaching their subject.

That fact now lives only in a comment on `longJobName` (tests/job.test.ts),
which is the copy the ladder says the harness should own. Candidate for a
`platform-facts.md` section beside the other two — human surface, so filed
here rather than written.

Consequence for future win32 fixtures: depth goes on the *subject* path
(a long job name, a deep `configDir`, a deep `pendingPath`), never on any
dir git is spawned in or asked to create a worktree under.

Nothing here is judgeable off-win32 — all three cases are `runIf(win32)`.
I un-gated them locally to prove the rewritten fixtures function; the lane
remains the verdict.
