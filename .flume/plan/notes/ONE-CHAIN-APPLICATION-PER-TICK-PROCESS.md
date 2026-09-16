# The kill-grace fold sits at the report, not at the derivation

Shipped: a tick process applies the factory once, and cli.ts reads
`Dispatcher.agentKillGraceMs`.

Why the fold is not in the bounds the engine hands `Agent.invoke`:
tests/Dispatcher.test.ts pins "an invocation carries neither field when the
chain declares no grace and nothing wired a stop signal". Folding
DEFAULT_KILL_GRACE_MS at the derivation would put `killGraceMs: 5000` on every
invocation and change what a third-party provider reads off the Agent seam —
a public-surface call this entry did not carry. So the derivation keeps the
chain's declared (optional) value and the fold lives once, in the reporting
getter. `?? DEFAULT_KILL_GRACE_MS` is now spelled at processTree (the applier)
and at that getter (the report); the copy in cli.ts is gone. If absence-means-
default on the Agent seam is worth retiring, that is a spec decision.

Left unreported: the timeout half of the resolved bounds (tickTimeoutMs) is
still memory-only — no consumer asks for it yet, so I did not invent a
surface. The loop parent's own resolve/fold stands, as the entry scoped it.
