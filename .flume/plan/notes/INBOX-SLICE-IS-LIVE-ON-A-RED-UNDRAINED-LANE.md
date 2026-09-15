# The lane leg puts a forge spawn on the selection path

`undrainedRedLane` (`harness/windows.ts`) runs inside the inbox slice's
`live`, so a plan selection over a tree with no record and no standing
refusal spawns `gh` twice per declared lane — the run listing and the run's
jobs. Records and refusals are asked first and short-circuit it, but a
hibernating loop pays it every tick, and an offline host pays a spawn plus
a failure per lane. Nothing caches the answer.

One divergence the spec's "unread renders only when the slice is live for
another reason" does not cover: liveness reads the run and its job's
conclusion, the render additionally fetches the failing job's log. A forge
that answers the first two and fails the third wakes the tick on the lane
and then renders it UNREAD — the tick drains nothing and is woken again
next tick. Self-correcting, but a ruling on whether the render should say
which lane woke the tick would make it visible rather than mysterious.
