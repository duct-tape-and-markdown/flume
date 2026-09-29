# A platform wall spends the whole tick budget: platform-preempt never joins the backstop

Observed 2026-09-29T18:18Z–18:26Z. The operator's Claude OAuth session
expired; every agent after that exited 1 in ~140ms with
`Failed to authenticate: OAuth session expired and could not be refreshed`
(session captures under `sessions/`, `"error":"authentication_failed"`).
The run recorded 80 `platform-preempt` no-commits — plan-derive and
plan-sweep each handing to the other, build alongside — and ended only at
`--max 50`, exit 0 ("40 tick(s) errored", partial success because entries
shipped before the wall).

`spec/loop.md`, *Repeated identical failures — quarantine, then abort*: the
accounting covers provision, render, merge and gate, and the backstop fires
on three consecutive identical stage-tagged signatures. `platform-preempt`
is not a stage in it, so a failure identical on every tick — the one class
no retry can move, and the one the section says the backstop exists for
("the non-entry-scoped class quarantine cannot isolate") — never accrues.
Cost here was ~$0 per tick, but the run burned its budget and reported a
green exit over a dead platform; a cap or rate limit that fails after some
spend would cost real money the same way.

The fork, probably a question: does `platform-preempt` join the accounting
as its own stage (signature: the agent's reported error, opaque equality as
the section already rules), or is a repeated platform failure a separate
abort? And whether a run whose last N ticks all preempted may exit 0.
Also: the handoff's "a slice that committed nothing excludes itself" let two
plan slices ping-pong forever — each excluded itself and woke the other.
