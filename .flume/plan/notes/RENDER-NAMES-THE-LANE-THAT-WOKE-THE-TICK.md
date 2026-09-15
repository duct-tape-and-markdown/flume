# A woken lane the forge will not read holds the inbox slice live with no escape

`wokenLanes` (`harness/windows.ts`) reads the status half alone: a lane whose
latest completed run failed past its `drainedRuns` stamp wakes the slice
whether or not the job's log then comes back. This entry made that visible —
the block names the lane and the run it woke over — but nothing closes it. A
forge holding the run and refusing its log (auth scope, expired retention)
wakes the inbox slice every tick forever, drains nothing, never hibernates.

Spec (`spec/harness.md`, *CI lanes as a findings source*) has the slice stamp
"the run it drained"; an unfetchable run was not drained, so stamping it is a
decision nobody has made and I did not make it. Forks for plan: let a tick
stamp an unreadable run as drained-empty; make an unread degraded from failing
not wake; or bound the re-wakes. The prompt currently tells the tick to name
lane and run in the commit body, which surfaces the stall to an operator but
does not end it.
