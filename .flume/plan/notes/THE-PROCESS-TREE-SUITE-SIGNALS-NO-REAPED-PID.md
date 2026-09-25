# An absent escalation has no observable effect, so it needs an instrument

Measured the entry's premise before fixing it: a `spawnProcessTree` child
ended by SIGTERM reports `exitCode: null` with `signalCode: "SIGTERM"`, so
the old teardown guard (`exitCode !== null` alone) returned "still live" and
would have aimed `process.kill(-pid, "SIGKILL")` at a reaped group leader.
The teardown now calls `signalProcessTree`, which already reads both fields
plus `pid === undefined` and swallows ESRCH.

The second half is the shape worth flagging. Over a reaped pid, an armed
escalation is unobservable by construction: the SIGKILL it would deliver
lands on whatever the host has since handed the pid to, never on anything
the case holds — which is why the old case could only sleep past the grace
and assert nothing. The verdict has to be read where the escalation is armed
(the `setTimeout` on the global clock), and an instrument like that is green
when it is broken, so the case carries its own control: the same call over a
live child must record one arming before the reaped child's zero is
believed. Two terminate calls with no await between them, so nothing else
reaches the clock in the window.

If more absence-of-timer verdicts land, that control-then-assert pair is a
helper (`armings(fn)`), not a copy. One instance is not yet a family.

Not touched: other `process.kill` sites in `tests/` (`cli.test.ts:2340`,
`:2494`, `:2969`, `tip-claim.integration.test.ts`) signal pids read out of
fixture files, not `ChildProcess` handles, so `signalProcessTree`'s guard
has nothing to share with them — no finding there.
