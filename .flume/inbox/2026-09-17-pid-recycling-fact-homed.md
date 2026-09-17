# Ruled: the pid-recycling fact is on the platform page

Closes `plan/questions/the-pid-recycling-fact-has-no-declared-home.md`
(a4db1188). Added as proposed, beside the process-stream cap: a reaped pid
returns to the host's allocation pool, so a "dead" pid harvested from a
just-exited child can name a stranger by the read under test; mint one
above the host's range and probe it at the point of use, through the one
helper. win32 recycles soonest. What derives: the helper's header shrinks
to a pointer at the section, case reasoning kept.
