# docs/CLI.md carries two more copies of the ignore set, one already drifted

Shipped as written: the chain guide's roster is now a pointer at
`spec/jobs.md`, "Runtime ignores".

Out of this entry's scope but the same defect, verified on disk this tick:

- `docs/CLI.md:102` (`flume job new`) spells the set as `awake/`,
  `prior-attempts/`, `rendered-prompts/`, `worktrees/`, `node_modules/`,
  `loop.pid` — six of ten, missing `tick-verdict.json`,
  `tick-verdicts.jsonl`, `stop`, `merging/`, and cites nothing. Already
  stale against `RUNTIME_IGNORES` — the argument the `per` section makes.
- `docs/CLI.md:148` (`flume jobs`) spells five names *and* cites
  `spec/jobs.md`, "Runtime ignores" — the cite makes the list redundant,
  but there the names carry a claim about which subdirs outlive a branch
  switch, so shrinking it is a judgment call, not mechanical.

The first is the mechanical one. Both are `docs/`, so nothing above prose
can hold either; deleting the copy is the whole fix, same as here.
