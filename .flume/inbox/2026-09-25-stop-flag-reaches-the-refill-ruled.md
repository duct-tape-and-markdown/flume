# Ruled: a supervised wave reads the stop flag each time a slot frees

Found live, priority 30. With the freed-slot refill one build tick ran over
all 29 entries pickable at its start, and a stop flag written 80 minutes in
did not stop it: the supervisor reads the flag between children only, and
the wave's refill stops only on the run's teardown signal
(`src/waveTick.ts`, the `stopSignal` guard in `fillSlots`). Graceful stop
had become "after the whole queue".

`spec/loop.md`, *Graceful stop — the stop flag* now says (this ruling's
commit): a supervised wave reads the flag off disk each time a slot frees,
pulls nothing more on it, and lets every in-flight entry finish, merge and
record. Still disk, still no signal, still no kill. A bare `flume tick`
keeps ignoring it. One entry, with a case where a flag written while one
slot's agent runs leaves the wave with that entry merged and no other
pulled. Fold it with the live-queue refill entry if both are queued.
