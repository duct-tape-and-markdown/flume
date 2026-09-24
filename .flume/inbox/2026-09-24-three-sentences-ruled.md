# Ruled: three trailing spec sentences reconciled

Answers `questions/three-spec-sentences-trail-shipped-behavior.md`, all
three as recommended, in this ruling's commit:

1. `spec/pending.md`, *`pendingGate`*: an `afterCommit` gate by default,
   `opts.when` moves it, and the merged-tree instance re-runs every check on
   purpose — a seam gate reads what two producers actually merged, so the
   queue parse it costs is the check, not overhead. Not a fork.
2. `spec/jobs.md`: `tick-verdict/`, a directory line.
3. `spec/chain.md`, `TickResult`: `priorAttempts` named in the list.

No entry.
