# The package's default agent writes a directory nothing ignores

`harness/chain.ts` builds every phase's agent as
`withTerminalRenderer(withSessionCapture(claudeCode(...)))`, teeing each
tick's stream to `<stateRoot>/sessions/` — the package's own per-run
artifact, and the only path the package places that the engine does not.

`consumerIgnores` (`harness/ignores.ts`) derives its lines from
`RUNTIME_IGNORES` filtered by the engine's `STATE_ROOT_NAMES`, so
`sessions/` is excluded by construction. An adopted repo carries a
permanently untracked directory after its first tick. No gate fires — it
sits outside every fence, so clean-tree filters it — which is why it is
worth filing now.

The fork is whose fact `sessions/` is: widen the ignore set to "what the
consumer's state root needs" (engine names plus package names), or drop
session capture from the package default and leave it to an agent seam the
declaration does not currently have.

Also decided here, worth a spec sentence: the factory **refuses** a state
root resolved outside the repository. Every discipline mechanic addresses a
path a commit must hold; `spec/harness.md` states no such precondition.
