# The drain amended a claimed entry on two consecutive ticks despite the claimed block

Observed at 78c75265 ("Third run at this drain"): the inbox tick amended
A-CONTINUATION-ROUTES-BACK-TO-BUILD-NOT-THE-DRAIN while a build tick held its
claim, the pending gate's claim check reverted the commit, and the next tick
did the same before the third left the entry alone. The prompt renders
`{{CLAIMED_ENTRIES}}` (`harness/prompts/plan-inbox.md:23`), so the fact was
in front of the agent both times and the block did not bind. Two agent ticks
spent to learn what one line should have said. Route: whatever makes the
block bind — its wording, its position beside the queue it qualifies, or the
prior-attempt record naming the claimed tag on the retry — is the harness's
to decide; the measurement is that the gate fired twice for one fact.
