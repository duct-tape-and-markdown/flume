# The loop exit-code pins read the set, never which file earns a code

CLI-DOC-LOOP-EXIT-CODES-PINNED and JOB-HELP-NAMES-THE-WHOLE-LOOP-RANGE both
compare the *set* of codes `loop` returns against the set the prose names. 74
was already in that set (stop flag, merging dir), so this tick gained a third
producer of 74 — an unreadable `loop.pid` — and both prose surfaces stayed
green while naming only two. I updated `src/cliHelp.ts`'s 74 row and
`docs/CLI.md` § `flume loop` by hand; nothing would have caught leaving them
stale.

Same hole on `tick`, `status`, `log` by construction: the pinned claim is
"every code is named", never "every cause of a code is named". A cause list
needs a per-arm fixture, the way CLI-DOC-STATUS-LOG-EXIT-CODES-PINNED drives
one real run per arm — that shape could extend here, at one spawned `flume
loop` per cause.

Worth an entry if the cause lists are load-bearing for operators; out of
scope for this one.
