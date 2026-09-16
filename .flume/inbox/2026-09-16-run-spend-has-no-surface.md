# A run's spend is on disk per tick and totalled nowhere (interactive session, flume-main)

Observed over loop 33: 146 ticks (95 plan, 50 build, 110 entries shipped),
and the operator learned the cost from the subscription's quota page at
65%, not from flume. Every agent invocation already leaves a usage row on
the tick verdict (`spec/loop.md`, *The tick verdict — one facts artifact*),
so the fact is reported — per tick, in a file nobody reads while a loop
runs. No surface adds it up: the loop's completion summary names ticks and
shipped tags but not what they cost; `flume status` (`spec/cli.md`,
*`flume status` owes exactly this*) and `flume log` total nothing.

Why it matters: the number that decides whether to keep a loop running is
the one number the operator cannot get without opening verdict files. A
plan-tick-to-build-wave ratio of 2:1 would have been visible at hour two.

Proposed: the completion summary totals usage by phase for the run; `flume
status` and `flume log` total the run so far, from the verdict rows the
engine already writes. Engine surface, no chain knob.
