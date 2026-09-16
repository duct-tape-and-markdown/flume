# A CI lane wakes plan on every push while the same reds stand (interactive session, flume-main)

Observed: with six posix-only titles red on the windows lane and all six
already heading one queued entry, every push (each spec landing) started a
run, the run failed on the same six, and the lane woke plan-inbox because
the run was red and past the stamp (`spec/harness.md`, *CI lanes as a
findings source*, liveness). At least five such ticks in loop 33 drained
nothing and stamped the run.

Why it matters: the wake is spec-conformant and each tick is cheap, but
it lands between the push and the next build wave, so a known red taxes
every landing with a plan tick that files nothing.

Proposed: the lane reader already parses failing titles. Wake only when
the latest failed run's title set differs from the stamped run's; a
same-set red advances the stamp at the next tick that runs anyway. The
stamped run's titles live in the plan state beside its id. Harness
behavior, no knob.
