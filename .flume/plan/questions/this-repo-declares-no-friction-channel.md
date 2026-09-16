# This repo declares no `friction`, so the channel it ships runs dark here

`.flume/declaration.ts` names no `friction` directory. Flume is the harness
package's reference consumer, and the friction channel is the one findings
source the package reads that this repo never exercises outside `tests/`: the
engine's revert notes, the teardown harvest, the `friction: N` status line and
the inbox slice's friction leg all have no field run here.

Declaring it is one line in `.flume/declaration.ts` — a `chore(flume):` commit
outside every autonomous fence (build writes `src/`, `harness/`, `tests/`,
`docs/`; the plan slices write only `.flume/plan/`). So neither the queue nor a
tick can close this; it is an interactive session's, which is why it is here
rather than a pending entry.

The fork is yours because it is a posture call, not a mechanism:

- (a) Declare one — `friction: "friction"` under the state root, gitignored by
  the engine's own ignore machinery. The loop then writes revert notes where
  this repo's own inbox slice will read them, and the leg stops being pinned
  only by fixtures. Cost: a new untracked directory under `.flume/`, and revert
  notes become inbox traffic a plan tick must drain.
- (b) Leave it undeclared and say so at the site, naming the reason — that the
  gate-revert record already reaches the retrying tick, so the operator's copy
  buys this repo nothing a prior-attempt block does not already carry.

(a) is the recommendation: a capability the reference consumer does not run is
a capability whose field behavior nobody has seen. (b) is named so that not
declaring one is a decision rather than an omission.

Raised by the build note on THE-INBOX-SLICE-READS-A-DECLARED-FRICTION-DIRECTORY.
