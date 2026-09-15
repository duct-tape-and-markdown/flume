# The loop-start ignore merge takes one chain path, by name

`consumerIgnores` now names `sessions/`, so adoption covers it. The other
writer of ignore lines does not: `ensureRuntimeIgnores` (`src/job.ts`, called
at loop start from `src/cli.ts`) merges `RUNTIME_IGNORES` plus exactly one
chain-supplied extra — `frictionIgnoreEntry(friction)`. A chain with any
other per-run artifact under the state root has no seam to ride, so this
repo's own `.flume/.gitignore` carries no `sessions/` line and the package's
transcripts are covered only by the root file the adoption verb wrote. A
consumer that adopted before this change, or whose root file drifted, gets no
second chance at loop start.

Candidate shape: widen that extra to a chain-declared set of state-root-
relative per-run paths and have `harnessChain` declare its sessions dir —
which also stops `Chain.friction` being a specific instance branched on
inside generic machinery (`.claude/rules/engineering.md`, *The fix lands at
the mechanism*). Not built here: it is an engine surface change, past this
entry's `per`.
