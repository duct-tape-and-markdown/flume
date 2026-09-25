# The obstructed state root is one arm of a class the other verbs still take

Shipped: `status` guards its baton construction and reports `EX_IOERR`
naming the resolved root. Two things the next plan tick should weigh.

1. **The same throw is live in every other verb.** `new Baton(flumeDir)` at
   `src/cli.ts` (`wake`, `sleep`), `src/Dispatcher.ts:586`, and
   `src/loopSupervisor.ts:427` all mkdir `<flumeDir>/awake` unguarded, so a
   state root that is present and not a directory still exits 1 on a raw
   stack there. Those verbs are not specced to keep exit 1 unreachable, so
   this entry left them alone — but the help pages for `wake`/`sleep` name
   74 for "the state root is present but will not stat", and an obstructed
   root stats clean, so their 74 rows under-state the same way `status`'s
   did. Candidate: one guard at the construction site rather than five at
   the callers (`engineering.md`, *The fix lands at the mechanism*).

2. **The docs pin's vacuity check constrains its own subject.**
   `tests/cliHelp.test.ts`, CLI-DOC-CHECK-AND-STATUS-IO-REFUSALS-PINNED
   asserts the 74 window names fewer state-root artifacts than the whole
   `flume status` section. `awake` is the only artifact outside that window
   today, so spelling `` `.flume/awake/` `` in the 74 sentence reds the pin
   with nothing wrong in the prose. The docs clause therefore says
   "awake-flag dir" in words. Accepted-debt line, not queued: the guard is
   doing its job over a vocabulary that happens to be one wide, and widening
   it is a decision about the pin, not this entry's.
