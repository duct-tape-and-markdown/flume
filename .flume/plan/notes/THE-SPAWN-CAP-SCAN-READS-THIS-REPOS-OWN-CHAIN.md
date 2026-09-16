# A red in the chain files is not build's to clear

The scan's second argument is now a domain — `{ trees, files }` — and its
result carries `modules`, the domain as it resolved. The named-file arm
exists because `.flume/` cannot be walked: it holds the worktree checkouts,
whole copies of this repo. A later scan wanting files outside a sweepable
tree has the shape to copy.

Worth knowing before filing against it: neither `.flume/chain.ts` nor
`.flume/declaration.ts` spawns today, so the repo verdict is empty over
them and the pin asserts only that the domain reached them. If one ever
does red, a build tick cannot clear it — `.flume/` is outside the build
fence, so the commit would revert. That red is an interactive session's,
and an entry filed at build would loop.
