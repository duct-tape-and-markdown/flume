# One of the two drop flags is not the stake's to carry

Shipped as the entry's acceptance names it: `stakePidClaim`'s release now
drops at most once, at the file its own stake created, and the bare tick's
`claimHeld` is gone (`src/cli.ts`). Both tip-claim drops are now bare
`?.release()` calls.

The entry's file line says "the two hand-held drop flags shrink"; only one
could. `lockHeld` in `dropLock` gates the *loop lock*, which is not a stake:
`flume loop` probes with `liveLoopPid` and then `writeFileSync`s the lock
itself, and `dropLock` `unlinkSync`s it directly (`src/cli.ts`, around the
`lockPath` const). With no stake there is no guard to inherit, and dropping
the flag would make a loop refused over another supervisor's live `loop.pid`
unlink the file it lost to on the exit handler. Left standing and cited at
the site.

That is the finding worth plan's time: the loop lock is the **third** guard
writing `renderPidClaim`, and the only one whose acquisition is
probe-then-write rather than `wx`-create-then-probe. It is therefore also
the only one with a real TOCTOU window — two `flume loop` starts can both
read no live holder and both write the lock, and the second silently
overwrites the first's claim. `stakePidClaim` already answers exactly this
guard's shape: `held` carries the holder's pid, which is all the refusal
message needs (`another loop (pid N) already runs against ...`). Folding it
in would close the window, delete `lockHeld`, and finish the mechanism this
entry only half-reached — but it changes `flume loop`'s startup arbitration,
so it is an entry of its own, not this one's scope.

Also: `acquireWaitLock` (`src/waitLock.ts`) builds its own release with the
unconditional `unlinkSync` this entry just fixed, and its doc calls it "the
same shape the tip claim's release carries" — now false. No current caller
double-releases a wait lock, but the two shapes have parted.
