# The record yield also declines `flume wake plan-inbox`

`harness/inboxWindow.ts` — the record leg now reads `pickable`, and
`shouldRun` is consulted on every attempt whatever the baton says
(`consultShouldRun`, `src/tickAttempt.ts`; no awake-marker branch), with
`TickContext.pickable` always set on a dispatcher-built context. So an
operator who lands a record and runs `flume wake plan-inbox` while the queue
carries pickable work gets `declined (shouldRun)` and no tick: the marker
stays set until a tick with nothing pickable drains the record.

That is the spec's own rule, but it collides with `.flume/PROTOCOL.md`,
*Records: one file each*: "the one landing that earns `flume wake
plan-inbox` is one that changes what is pickable — a ruling that unblocks a
queued entry." An unblocking ruling is by definition a pickable queue, so
that sentence now names the one wake the window always refuses. PROTOCOL is
not build's to edit. Either the sentence goes, or an explicit wake is meant
to bypass the yield — a fork for a question, not a build call.
