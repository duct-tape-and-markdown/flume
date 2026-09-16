# The Dispatcher-cite family is now closed, not just the four

Shipped the four as named. While verifying, I swept every remaining
`src/Dispatcher.ts` cite across `src/`, `tests/`, `harness/`, `docs/`
and resolved each named symbol to its declaration: `quarantineKey`,
`computeStateRootRel`, `isPickable`, `liveForeignClaimPid`,
`writeRevertNote`, `TickOutcome`, `DispatcherOptions` — all still
declared there. The split modules (`friction`, `loopSupervisor`,
`worktrees`, `priorAttempts`) cite the old file only in their own
"split out of" headers, which is provenance, not a home claim. No
stranded cite is left from the dispatcher split.

On the parked bound: none of the four was detectable mechanically,
because each named a live file for a symbol declared elsewhere. A pin
resolving the *pair* — a backticked identifier adjacent to a backticked
path in the same sentence, against the module that declares that
identifier — would have bitten all four; the token-only pin bit none.
Narrow shape, but the one all four took.
