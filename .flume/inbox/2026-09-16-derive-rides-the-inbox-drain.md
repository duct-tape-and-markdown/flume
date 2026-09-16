# Derive spends a tick to advance a cursor the inbox drain already earned (interactive session, flume-main)

Observed: ten plan-derive ticks in loop 33 judged "already queued — cursor
advances alone" (e.g. d246140, 6f63f64, 95cef8f, cb19a4e, 9fdc468,
7ef5bb9). Each followed a plan-inbox tick that drained a record closing the
very spec commit derive then re-read: the record names the ruling's commit,
the drain files or amends the derivation, and derive finds nothing left.

Why it matters: an interactive ruling costs two plan ticks where one did
the work; at twelve rulings a day that is a build wave's worth of spend
that ships nothing.

Proposed (`spec/harness.md`, *Plan state as declared state*, *The phases*):
when the inbox slice drains a record that cites a spec commit past
`derivedThrough` and routes its derivation, the same tick advances the
derive cursor through that commit. Derive runs only for spec deltas no
drained record claimed. Harness behavior, no knob.
