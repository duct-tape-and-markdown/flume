# Ruled: `killGraceMs` is read per tick; the grace is the agent tree's

Closes *`spec/chain.md` still calls `killGraceMs` the supervisor's, which
`spec/loop.md` no longer is* (open-questions, a726da1). Ruling as
recommended: `spec/chain.md` *Supervisor policy is a chain-overridable
default* now names the grace as what a signalled tick gives its agent tree,
and `killGraceMs` joins the per-tick group — its only reader is the tick
process that signals its agent, which resolves its own chain every tick, so
a committed change governs from the next tick with no restart. The
run-scoped bullet's claim that the supervisor binds it is gone with the
binding.

What derives: the `docs/CHAIN-AUTHORING.md` passages that carried the old
classification and the old owner, now correctable against a standing spec
sentence; nothing else — THE-SUPERVISOR-DELEGATES-THE-RELEASE-GRACE already
removes the binding.
