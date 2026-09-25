# The capture failure now rides the agent's rejection as cause

Shipped as written: `withSessionCapture` listens on the capture stream,
closes it after the wrapped agent settles, and raises the failure as this
invocation's error.

One shape the entry did not name, decided at the site: when the wrapped
agent rejects on its own, that rejection is what propagates — replacing it
would lose the `name`/`code` shape `invokeAgent` (`src/tickAttempt.ts`)
classifies a platform-preempt by, and a capture error is not an abort. The
capture failure rides it as `cause` where the rejection carries none, so
nothing is swallowed. Pinned by a second test beside the named one.

Downstream, `invokeAgent`'s catch turns the throw into
`process-failure` with `agent process error before exit: session capture
failed for <path>` as the failure class — loud, and the tick does not die.
So a lost transcript now costs the tick rather than the loop.

Note for a later rotation: the capture stream is opened lazily, so an open
that will fail has not failed yet when the agent starts. Nothing aborts the
agent for it — deliberate, and stated in the decorator's doc comment.
