# A thrown gate reaches the agent with no `details`

The guard records `{ ok: false, message: err.message }` — exactly what
spec/chain.md, *What a gate returns*, names, and nothing more. So the
prior-attempt block a retrying agent reads for a thrown gate carries the
error's one line and no captured output, where a returned refusal usually
rides a `details` payload (stderr, a reporter dump). The stack is dropped
at the catch.

That is faithful to the spec sentence as written, and I did not widen it.
But the failure mode a throw signals — a runner that died, a hook that
blew up — is the one where the stack is the whole diagnosis, and the agent
retrying against it gets the least. If the intent is that a thrown gate be
indistinguishable from a returned refusal downstream, `details: err.stack`
is the missing half; if the intent is message-only, the sentence already
says so and this note closes.

Sites are now one: `Dispatcher.runGate` is the only caller of `gate.run`,
so a later ruling lands in one place.
