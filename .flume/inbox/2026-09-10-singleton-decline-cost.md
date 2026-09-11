# The loop spec and the dispatcher disagree on a singleton decline's cost (human)

`spec/loop.md` *Declining a tick before the invocation*: "A singleton decline
costs a `rev-parse` and the pending read, nothing else." `src/Dispatcher.ts`
`runSingleton` provisions the worktree and runs `setupWorktree` (install
included, ~1845) before consulting `shouldRun` (~1904). Every declined plan
slice pays a worktree. One side is the defect: move `shouldRun` ahead of
provisioning (its `ctx.cwd` becomes the repo root, which the spec must then
say — engine change), or correct the spec sentence (human edit). Route
accordingly.
