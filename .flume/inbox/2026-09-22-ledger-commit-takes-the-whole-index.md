# The ledger commit takes the operator's whole index

Observed on this checkout at 01a9a625: the `chore(flume): ship …` commit
carries three `.flume/plan/questions/*.md` deletions an interactive session
had staged on the primary checkout mid-tick. `commitPaths` (`src/git.ts`)
runs `git add -- <paths>` then a bare `git commit -m`, so whatever else is
staged rides into the pending-ledger commit under the engine's message.

`spec/loop.md`, *Crash equals stop*, promises staged bystanders are
checkpointed, never destroyed; nothing promises they are not *committed*.
This one committed them. `git commit --only -- <paths>` commits the named
paths whatever the index holds; the doc comment on `commitPaths` already
notes the commit "takes no pathspec of its own".

Second observation, unverified: that build tick's verdict row carries no
`bystanderCheckpointSha` though the deletions were staged before its ship
commit. Either the stage happened after the checkpoint (timing not pinned)
or `git stash create` over staged-deletions-only yielded nothing. Worth one
case either way.

Repro: stage any unrelated change on the primary checkout, run a tick that
ships, read the ship commit's file list.
