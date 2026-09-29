# The pin's literal subject is unconstructable; the reachable rung is one below

Shipped as filed: `liveForeignClaimPid` (`src/tipVerify.ts`) now proves the
descent with `existsLoudUnder("tip claim", commonDir, claimPath)` before
`liveTipClaimPid` — the same call `flume status` takes over this path.

Two things the next plan tick should know.

1. The pin line names "a tip claim whose git common dir is present and is not
   a directory". That state cannot be reached: git validates the common dir
   before answering `rev-parse --git-common-dir`. Measured three ways on git
   2.43 — `GIT_COMMON_DIR=<plain file>` (with and without `GIT_DIR`), and a
   linked worktree whose `.git/worktrees/<n>/commondir` was repointed at a
   plain file — every one exits 128 `fatal: not a git repository`, so
   `currentRefPath` returns `not-a-repository` and the read is never taken.
   The reachable head of the descent is `<commonDir>/flume`, and that is what
   the test obstructs; the title is the pin line verbatim so it resolves, with
   the divergence stated at the site. Respell the pin next rotation if the
   title/body gap matters — suggested: "…whose tip-claims directory under the
   git common dir is present and is not a directory".

2. The pin is green on the pre-fix tree, as `pins[]` requires: posix answers
   `ENOTDIR` from the leaf read and its message carries the obstructed path as
   a prefix, so the assertion holds both sides. The behavior change is win32's
   alone. Nothing in the default lane can red on it — accepted.

Debt, not filed: `src/cli.ts`'s `status` block spells the same
`existsLoudUnder` + `liveTipClaimPid` pair over the same path, so the pairing
now has two homes. It is not the same job — `status` must split
present-but-dead from absent, which `liveForeignClaimPid` collapses to `null` —
so no shared helper was cut. Worth a cohesion note if a third caller appears.
