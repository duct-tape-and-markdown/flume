# The cap scan stops at the trees build can write

Six sites capped; tests/spawnCaps.test.ts now reds any capturing spawn in
bin/, examples/, harness/, scripts/, src/ written without a maxBuffer of
its own.

Two surfaces the scan does not reach, both plan's call:

1. `.flume/chain.ts` and `.flume/declaration.ts`, because build cannot
   write them. Neither spawns anything today, so nothing is broken — but
   this repo's own chain is the one consumer the pin misses, and a spawn
   added there would inherit 1 MiB silently. Widening the domain needs the
   fix to be landable by an interactive session.

2. tests/. A suite's spawns are judged for their lane budget
   (tests/helpers/spawnBudget.ts), not their cap. tests/helpers/
   subprocess.ts caps its own wrapper, so the lane goes through one capped
   seam today; a case spawning directly would not be seen.

The scan resolves names globally, with no import graph — a wrapper found in
one module is judged at its call sites everywhere. Trade stated at the
helper's head.
