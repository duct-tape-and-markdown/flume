# Parked: no failing-title harvest exists for the wake to compare

The entry's note says the titles are "what ci.ts already harvests from a
failed job's log (:278)". It does not. ci.ts:278 is the `logLines` budget
comment; ci.ts:11 refuses the harvest by name — "No test title is parsed out
of that log here ... taking a finding out of material the package did not
author is the slice's agent's job". Nothing under harness/ or src/ extracts a
test title.

The stamp shape (planState.ts) and the render are mechanical, but the wake is
not: the liveness leg needs the *current* run's title set, and no surface
produces one. Unruled forks:

- the lane declares its title reader (pattern or function) — told-not-
  inferred, but a declaration + schema change this entry does not carry;
- the package parses a runner's output shape — the grammar ci.ts:11 refuses;
- the forge's check-run annotations (structured, so no prose parse) — empty
  for any reporter not emitting `::error title=`, so the lane silently stops
  waking.

Either way liveness must fetch a failing job's log on the selection path,
which `laneLeg`'s memo doc (ciLane.ts) argues against by name.
