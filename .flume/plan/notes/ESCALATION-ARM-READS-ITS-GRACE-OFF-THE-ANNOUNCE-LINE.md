# The teardown stopwatch had one consumer, and it is gone

The escalation arm was the only reader of `teardownMs` on
`signalledBareTickRun`'s exit promise, so moving it onto the announce line
left the stopwatch (`signalledAt`, the field, the subtraction) dead plumbing
in the driver. Removed in the same commit; the two remaining readers of
`exited` take `{ code, signal }` only.

Nothing else in `tests/cli.test.ts` compares a wall clock against a grace now:
`DECLARED_GRACE_MS` is read only as the number a tick announces, and its doc
comment's "far enough under `DEFAULT_KILL_GRACE_MS`" rationale — which was the
deleted ceiling's — shrank to "different from", which is what a `toContain`
over the announced number actually needs.

Two load-sized numbers survive in that region, neither a comparison against a
grace and neither implicated by the inbox flake: `WEDGED_HOLD_MS` (the
wedged-child arm's `delay`, whose subject is a run *not* ending, so it has no
event to wait on) and `SPAWN_BUDGET_MS` (the per-case ceiling). If a later
flake lands on the wedged arm, that `delay` is the site — the one arm here the
cited section's event-based rule cannot reach as written, and it says so at
the site.

Discrimination checked by mutation, not by reading: swapping the expected
number to `DEFAULT_KILL_GRACE_MS` reds with `expected '[flume] signalled;
waiting for the ag…' to contain '5000ms'`, so the line carries the declared
250ms and a tick falling back to the engine default would not pass the arm.
