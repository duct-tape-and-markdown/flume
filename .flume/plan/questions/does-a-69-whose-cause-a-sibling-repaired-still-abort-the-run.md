# Does a mount-dead 69 still abort the run when the cause no longer holds at the tip?

Observed (inbox, operator, run of 2026-10-07T16:33:59Z, `maxTicks` 2): the queue
held two entries carrying the retired `priority` key, so the strict parse refused
it. The supervisor started `build` and `plan-inbox` together. `plan-inbox` had the
parse failure handed to it as a tick fact and repaired both files (`1d98eeee`,
cherry-picked 16:35:18.054Z). The `build` child exited 69 on the same parse
failure, and 227 ms later the supervisor aborted the run — with the cause already
restored on the tip. Under `maxTicks` 1 the same queue would have dispatched
`plan-inbox` first and never started the build child.

**The spec rules the current behavior, and its own reason splits by leg.**
`spec/loop.md`, *Exit codes — the run never lies to CI* says "Mount-dead aborts
immediately… A mount-dead chain is exactly as dead next tick as this one." True of
the three chain-resolution legs. The same section's own 69 paragraph says the
ledger-parse leg persists only "until the queue's declared writer runs over it" —
and here that writer was running, as a sibling, and won. So the abort keys on a
child's exit, never on whether the named cause still holds at the tip the
supervisor is about to dispatch from.

Three arms:

- **(a) Don't start a phase that cannot parse the queue while a declared writer of
  it is running.** Scheduling-side; keeps the abort exactly as specced. Costs a
  supervisor read of "is a queue-writing phase in flight", which it already knows.
  Does nothing for a 69 raised by a child that started before the repair.
- **(b) A 69 whose cause the tip no longer holds is not run-fatal — re-read before
  aborting.** Covers both orderings. Costs one parse at abort time and splits the
  abort by leg: chain-resolution legs stay unconditional (nothing a sibling can
  repair), the parse leg re-reads. The re-read is from disk at the tip, so the
  decision stays on durable evidence (`engine-boundary.md`, *Told, not inferred*).
- **(c) Leave it.** The operator re-runs; the repair has already landed, so the
  second run is green. Costs one aborted run per queue-schema change — which is
  exactly when two slices are most likely awake together.

I lean **(b)**, with (a) as a cheap complement rather than an alternative: (b) is
the arm that matches the section's own distinction between a dead chain and a
repairable queue. Either way the spec sentence has to move first — neither arm has
a cite today, which is why this is a question and not an entry.

Repro: two queue files with an unknown core key, `maxTicks` 2, `build` and
`plan-inbox` awake.
