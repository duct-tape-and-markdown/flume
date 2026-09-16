# Two more Dispatcher jobs found homes than the entry named

`runAttempt` and `selectBatch` landed as specified. Two extras the
unification forced, both behavior-free:

- `selectBatch` reports `partitionIgnore` too. `commitPendingUpdate` took it
  as an argument from a `runFanout` local that re-read
  `supervisorPolicy.partitionIgnore`; with the read moved, the list the
  partition actually collided on is reported, not re-read (engineering.md,
  *A fact the engine holds is reported*).
- The per-entry result's `commitSha` merged into `headSha` + `committed` —
  two names for one worktree sha, split only by whether the span survived.
  The wave loop's guard reads the discriminator now.

Left standing: `src/Dispatcher.ts` is still ~4000 lines. Selection, attempt,
singleton-merge and wave-merge are now four separable blocks with narrow
seams — a plausible next split, but it moves code across files and wants its
own entry.
